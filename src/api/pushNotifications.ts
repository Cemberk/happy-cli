// Re-export local notification system for complete data sovereignty
export { 
    LocalNotificationClient as PushNotificationClient
} from './localNotifications'

// Re-export types from localNotifications to avoid conflicts
export type { LocalPushToken as PushToken } from './localNotifications'
export type { LocalPushMessage as ExpoPushMessage } from './localNotifications'

// Legacy interface for backward compatibility - now maps to local system
export interface LegacyPushToken {
    id: string
    token: string
    createdAt: number
    updatedAt: number
}