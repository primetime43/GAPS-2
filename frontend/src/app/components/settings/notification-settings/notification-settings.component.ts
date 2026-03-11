import { Component, OnInit } from '@angular/core';
import { NotificationService, NotificationConfig } from '../../../services/notification.service';

@Component({
  selector: 'app-notification-settings',
  templateUrl: './notification-settings.component.html',
  styleUrls: ['./notification-settings.component.scss'],
  standalone: false
})
export class NotificationSettingsComponent implements OnInit {
  loading = true;

  // Discord
  discordEnabled = false;
  discordWebhookUrl = '';

  // Telegram
  telegramEnabled = false;
  telegramBotToken = '';
  telegramChatId = '';

  // Email
  emailEnabled = false;
  emailSmtpHost = '';
  emailSmtpPort = 587;
  emailUsername = '';
  emailPassword = '';
  emailFrom = '';
  emailTo = '';

  // UI state per service
  saving: { [key: string]: boolean } = {};
  testing: { [key: string]: boolean } = {};
  messages: { [key: string]: { text: string; type: 'success' | 'error' } } = {};

  constructor(private notificationService: NotificationService) {}

  ngOnInit(): void {
    this.notificationService.getConfig().subscribe({
      next: (config) => {
        this.discordEnabled = config.discord.enabled;
        this.discordWebhookUrl = config.discord.webhook_url;

        this.telegramEnabled = config.telegram.enabled;
        this.telegramBotToken = config.telegram.bot_token;
        this.telegramChatId = config.telegram.chat_id;

        this.emailEnabled = config.email.enabled;
        this.emailSmtpHost = config.email.smtp_host;
        this.emailSmtpPort = config.email.smtp_port;
        this.emailUsername = config.email.username;
        this.emailPassword = config.email.password;
        this.emailFrom = config.email.from_addr;
        this.emailTo = config.email.to_addr;

        this.loading = false;
      },
      error: () => { this.loading = false; }
    });
  }

  saveDiscord(): void {
    this.saving['discord'] = true;
    this.clearMessage('discord');
    this.notificationService.saveConfig('discord', {
      enabled: this.discordEnabled,
      webhook_url: this.discordWebhookUrl,
    }).subscribe({
      next: () => { this.showMessage('discord', 'Saved', 'success'); this.saving['discord'] = false; },
      error: () => { this.showMessage('discord', 'Failed to save', 'error'); this.saving['discord'] = false; }
    });
  }

  saveTelegram(): void {
    this.saving['telegram'] = true;
    this.clearMessage('telegram');
    this.notificationService.saveConfig('telegram', {
      enabled: this.telegramEnabled,
      bot_token: this.telegramBotToken,
      chat_id: this.telegramChatId,
    }).subscribe({
      next: () => { this.showMessage('telegram', 'Saved', 'success'); this.saving['telegram'] = false; },
      error: () => { this.showMessage('telegram', 'Failed to save', 'error'); this.saving['telegram'] = false; }
    });
  }

  saveEmail(): void {
    this.saving['email'] = true;
    this.clearMessage('email');
    this.notificationService.saveConfig('email', {
      enabled: this.emailEnabled,
      smtp_host: this.emailSmtpHost,
      smtp_port: this.emailSmtpPort,
      username: this.emailUsername,
      password: this.emailPassword,
      from_addr: this.emailFrom,
      to_addr: this.emailTo,
    }).subscribe({
      next: () => { this.showMessage('email', 'Saved', 'success'); this.saving['email'] = false; },
      error: () => { this.showMessage('email', 'Failed to save', 'error'); this.saving['email'] = false; }
    });
  }

  testService(service: string): void {
    this.testing[service] = true;
    this.clearMessage(service);
    this.notificationService.testNotification(service).subscribe({
      next: (res) => { this.showMessage(service, res.message || 'Sent!', 'success'); this.testing[service] = false; },
      error: (err) => { this.showMessage(service, err.error?.error || 'Test failed', 'error'); this.testing[service] = false; }
    });
  }

  private showMessage(service: string, text: string, type: 'success' | 'error'): void {
    this.messages[service] = { text, type };
  }

  private clearMessage(service: string): void {
    delete this.messages[service];
  }
}
