import logging
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import requests
from app.services import config_store

logger = logging.getLogger(__name__)

CONFIG_KEY = 'notifications'


class NotificationService:
    def __init__(self):
        pass

    def get_config(self) -> dict:
        saved = config_store.get(CONFIG_KEY, {})
        return {
            'discord': {
                'enabled': saved.get('discord', {}).get('enabled', False),
                'webhook_url': saved.get('discord', {}).get('webhook_url', ''),
            },
            'telegram': {
                'enabled': saved.get('telegram', {}).get('enabled', False),
                'bot_token': saved.get('telegram', {}).get('bot_token', ''),
                'chat_id': saved.get('telegram', {}).get('chat_id', ''),
            },
            'email': {
                'enabled': saved.get('email', {}).get('enabled', False),
                'smtp_host': saved.get('email', {}).get('smtp_host', ''),
                'smtp_port': saved.get('email', {}).get('smtp_port', 587),
                'username': saved.get('email', {}).get('username', ''),
                'password': saved.get('email', {}).get('password', ''),
                'from_addr': saved.get('email', {}).get('from_addr', ''),
                'to_addr': saved.get('email', {}).get('to_addr', ''),
            },
        }

    def save_config(self, service: str, config: dict) -> None:
        saved = config_store.get(CONFIG_KEY, {})
        saved[service] = config
        config_store.put(CONFIG_KEY, saved)

    def test(self, service: str) -> tuple[bool, str]:
        """Send a test notification."""
        return self.notify(service, 'GAPS Test', 'This is a test notification from GAPS 2.')

    def notify_scan_results(self, gaps_count: int, collections_count: int, library: str) -> None:
        """Send scan results to all enabled services."""
        if gaps_count == 0:
            title = 'GAPS Scan Complete'
            message = f'No missing movies found in "{library}". Your collection is complete!'
        else:
            title = f'GAPS Found {gaps_count} Missing Movies'
            message = f'Found {gaps_count} missing movies across {collections_count} collections in "{library}".'

        config = self.get_config()
        for service in ('discord', 'telegram', 'email'):
            if not config[service].get('enabled'):
                continue
            try:
                ok, detail = self.notify(service, title, message)
                if ok:
                    logger.info("Sent %s notification for scan results", service)
                else:
                    logger.warning("Failed to send %s notification: %s", service, detail)
            except Exception as e:
                logger.warning("Failed to send %s notification: %s", service, e)

    def notify(self, service: str, title: str, message: str) -> tuple[bool, str]:
        config = self.get_config()
        svc_config = config.get(service, {})

        if service == 'discord':
            return self._send_discord(svc_config, title, message)
        elif service == 'telegram':
            return self._send_telegram(svc_config, title, message)
        elif service == 'email':
            return self._send_email(svc_config, title, message)
        return False, 'Unknown service'

    def _send_discord(self, config: dict, title: str, message: str) -> tuple[bool, str]:
        url = config.get('webhook_url', '')
        if not url:
            return False, 'No webhook URL configured'

        payload = {
            'embeds': [{
                'title': title,
                'description': message,
                'color': 48268,  # #00bc8c
            }]
        }
        try:
            resp = requests.post(url, json=payload, timeout=10)
            if resp.status_code == 204:
                return True, 'Sent'
            return False, f'Discord returned status {resp.status_code}'
        except Exception as e:
            return False, str(e)

    def _send_telegram(self, config: dict, title: str, message: str) -> tuple[bool, str]:
        bot_token = config.get('bot_token', '')
        chat_id = config.get('chat_id', '')
        if not bot_token or not chat_id:
            return False, 'Bot token and chat ID are required'

        text = f'*{title}*\n{message}'
        try:
            resp = requests.post(
                f'https://api.telegram.org/bot{bot_token}/sendMessage',
                json={'chat_id': chat_id, 'text': text, 'parse_mode': 'Markdown'},
                timeout=10,
            )
            data = resp.json()
            if data.get('ok'):
                return True, 'Sent'
            return False, data.get('description', 'Unknown error')
        except Exception as e:
            return False, str(e)

    def _send_email(self, config: dict, title: str, message: str) -> tuple[bool, str]:
        host = config.get('smtp_host', '')
        port = config.get('smtp_port', 587)
        username = config.get('username', '')
        password = config.get('password', '')
        from_addr = config.get('from_addr', '')
        to_addr = config.get('to_addr', '')

        if not all([host, from_addr, to_addr]):
            return False, 'SMTP host, from address, and to address are required'

        msg = MIMEMultipart()
        msg['From'] = from_addr
        msg['To'] = to_addr
        msg['Subject'] = title
        msg.attach(MIMEText(message, 'plain'))

        try:
            with smtplib.SMTP(host, port, timeout=10) as server:
                server.ehlo()
                if port != 25:
                    server.starttls()
                if username and password:
                    server.login(username, password)
                server.sendmail(from_addr, to_addr, msg.as_string())
            return True, 'Sent'
        except Exception as e:
            return False, str(e)
