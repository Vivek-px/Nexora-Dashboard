"""WhatsApp (Meta Cloud API) and SMS (Twilio or MSG91) delivery.

Credentials come only from backend/.env (never from code or the browser). When a channel is not configured the
alert is still stored and shown in the dashboard, and the delivery is logged as 'not_configured'.
"""
import os
import re

import httpx

TIMEOUT = 15


def _client():
    """HTTP client for providers (replaced in tests)."""
    return httpx.Client(timeout=TIMEOUT)


def env(key, default=''):
    return os.environ.get(key, default).strip()


def status():
    """Which channels are configured (no secrets returned)."""
    sms = env('SMS_PROVIDER').lower()
    return {
        'whatsapp': bool(env('WHATSAPP_TOKEN') and env('WHATSAPP_PHONE_NUMBER_ID')),
        'whatsapp_mode': 'template' if env('WHATSAPP_TEMPLATE') else 'text',
        'sms': (sms == 'twilio' and bool(env('TWILIO_ACCOUNT_SID') and env('TWILIO_AUTH_TOKEN') and env('TWILIO_FROM')))
               or (sms == 'msg91' and bool(env('MSG91_AUTH_KEY') and env('MSG91_TEMPLATE_ID'))),
        'sms_provider': sms or 'none',
    }


def normalise_phone(phone):
    """E.164 digits; Indian 10-digit numbers get +91."""
    digits = re.sub(r'[^\d+]', '', phone or '')
    if digits.startswith('+'):
        return digits
    if len(digits) == 10:
        return '+91' + digits
    if len(digits) == 12 and digits.startswith('91'):
        return '+' + digits
    return '+' + digits if digits else ''


def send_whatsapp(phone, text, client=None):
    token, number_id = env('WHATSAPP_TOKEN'), env('WHATSAPP_PHONE_NUMBER_ID')
    if not (token and number_id):
        return 'not_configured', 'Set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID in backend/.env'
    to = normalise_phone(phone).lstrip('+')
    template = env('WHATSAPP_TEMPLATE')
    if template:
        # Business-initiated messages need an approved template. Use one with a single {{1}} body parameter.
        payload = {'messaging_product': 'whatsapp', 'to': to, 'type': 'template',
                   'template': {'name': template, 'language': {'code': env('WHATSAPP_TEMPLATE_LANG', 'en')},
                                'components': [{'type': 'body', 'parameters': [{'type': 'text', 'text': text[:1000]}]}]}}
    else:
        # Free-form text only reaches people who messaged the business number in the last 24 hours.
        payload = {'messaging_product': 'whatsapp', 'to': to, 'type': 'text', 'text': {'body': text[:4000]}}
    url = f"https://graph.facebook.com/{env('WHATSAPP_API_VERSION', 'v21.0')}/{number_id}/messages"
    try:
        c = client or _client()
        r = c.post(url, json=payload, headers={'Authorization': f'Bearer {token}'})
        return ('sent', r.text[:300]) if r.status_code < 300 else ('failed', f'{r.status_code}: {r.text[:300]}')
    except httpx.HTTPError as e:
        return 'failed', str(e)[:300]


def send_sms(phone, text, client=None):
    provider = env('SMS_PROVIDER').lower()
    to = normalise_phone(phone)
    try:
        c = client or _client()
        if provider == 'twilio':
            sid, auth, sender = env('TWILIO_ACCOUNT_SID'), env('TWILIO_AUTH_TOKEN'), env('TWILIO_FROM')
            if not (sid and auth and sender):
                return 'not_configured', 'Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM in backend/.env'
            r = c.post(f'https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json',
                       data={'To': to, 'From': sender, 'Body': text[:1500]}, auth=(sid, auth))
        elif provider == 'msg91':
            key, template = env('MSG91_AUTH_KEY'), env('MSG91_TEMPLATE_ID')
            if not (key and template):
                return 'not_configured', 'Set MSG91_AUTH_KEY and MSG91_TEMPLATE_ID in backend/.env'
            # MSG91 Flow API: the DLT-approved template must contain a variable named 'message'.
            r = c.post('https://control.msg91.com/api/v5/flow/', headers={'authkey': key},
                       json={'template_id': template, 'short_url': '0',
                             'recipients': [{'mobiles': to.lstrip('+'), 'message': text[:300]}]})
        else:
            return 'not_configured', 'Set SMS_PROVIDER=twilio or msg91 in backend/.env'
        return ('sent', r.text[:300]) if r.status_code < 300 else ('failed', f'{r.status_code}: {r.text[:300]}')
    except httpx.HTTPError as e:
        return 'failed', str(e)[:300]


def send(channel, phone, text, client=None):
    return send_whatsapp(phone, text, client) if channel == 'whatsapp' else send_sms(phone, text, client)
