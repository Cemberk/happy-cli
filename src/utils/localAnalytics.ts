/**
 * Local Analytics for Happy CLI
 * Privacy-focused usage tracking that stays within Nebula network
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { configuration } from '@/configuration';

interface AnalyticsEvent {
    id: string;
    event: string;
    properties?: Record<string, any>;
    timestamp: number;
    deviceId: string;
    sessionId?: string;
}

interface AnalyticsSummary {
    totalEvents: number;
    commandsExecuted: number;
    sessionsCreated: number;
    deviceInfo: {
        platform: string;
        nodeVersion: string;
        cliVersion: string;
        deviceId: string;
    };
}

class LocalAnalytics {
    private deviceId: string;
    private analyticsFile: string;
    
    constructor() {
        this.deviceId = this.generateDeviceId();
        this.analyticsFile = join(configuration.happyHomeDir, 'analytics.json');
        this.ensureAnalyticsDir();
    }
    
    private generateDeviceId(): string {
        const os = require('os');
        const crypto = require('crypto');
        const hostname = os.hostname();
        const platform = os.platform();
        const userInfo = os.userInfo();
        
        const identifier = `${hostname}_${platform}_${userInfo.username}`;
        return crypto.createHash('sha256').update(identifier).digest('hex').substring(0, 16);
    }
    
    private ensureAnalyticsDir(): void {
        try {
            if (!existsSync(configuration.happyHomeDir)) {
                mkdirSync(configuration.happyHomeDir, { recursive: true });
            }
        } catch (error) {
            // Fail silently - analytics is not critical
        }
    }
    
    /**
     * Record an analytics event
     */
    track(event: string, properties?: Record<string, any>, sessionId?: string): void {
        try {
            const analyticsEvent: AnalyticsEvent = {
                id: `cli_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                event,
                properties: {
                    ...properties,
                    platform: process.platform,
                    nodeVersion: process.version,
                    cliVersion: require('../../package.json').version,
                },
                timestamp: Date.now(),
                deviceId: this.deviceId,
                sessionId
            };
            
            this.storeEvent(analyticsEvent);
            
            // Log for development (remove in production)
            if (process.env.DEBUG) {
                console.log('📊 CLI Analytics:', event, properties);
            }
        } catch (error) {
            // Fail silently - analytics should never break the app
        }
    }
    
    private storeEvent(event: AnalyticsEvent): void {
        try {
            const events = this.getStoredEvents();
            events.push(event);
            
            // Keep only last 1000 events to prevent disk bloat
            const recentEvents = events.slice(-1000);
            
            writeFileSync(this.analyticsFile, JSON.stringify(recentEvents, null, 2));
        } catch (error) {
            // Fail silently
        }
    }
    
    private getStoredEvents(): AnalyticsEvent[] {
        try {
            if (!existsSync(this.analyticsFile)) {
                return [];
            }
            
            const data = readFileSync(this.analyticsFile, 'utf8');
            return JSON.parse(data) || [];
        } catch (error) {
            return [];
        }
    }
    
    /**
     * Get analytics events (for local viewing)
     */
    getEvents(limit?: number, since?: number): AnalyticsEvent[] {
        const events = this.getStoredEvents();
        let filteredEvents = events;
        
        if (since) {
            filteredEvents = events.filter(event => event.timestamp >= since);
        }
        
        return limit ? filteredEvents.slice(-limit) : filteredEvents;
    }
    
    /**
     * Get events by type
     */
    getEventsByType(eventType: string): AnalyticsEvent[] {
        return this.getStoredEvents().filter(event => event.event === eventType);
    }
    
    /**
     * Get analytics summary
     */
    getSummary(): AnalyticsSummary {
        const events = this.getStoredEvents();
        
        const commandEvents = events.filter(e => e.event === 'command_executed');
        const sessionEvents = events.filter(e => e.event === 'session_created');
        
        const latestEvent = events[events.length - 1];
        
        return {
            totalEvents: events.length,
            commandsExecuted: commandEvents.length,
            sessionsCreated: sessionEvents.length,
            deviceInfo: {
                platform: process.platform,
                nodeVersion: process.version,
                cliVersion: require('../../package.json').version,
                deviceId: this.deviceId
            }
        };
    }
    
    /**
     * Export analytics data (for sharing within Nebula network)
     */
    exportEvents(): string {
        return JSON.stringify(this.getStoredEvents(), null, 2);
    }
    
    /**
     * Clear all analytics data
     */
    clearEvents(): void {
        try {
            if (existsSync(this.analyticsFile)) {
                writeFileSync(this.analyticsFile, JSON.stringify([], null, 2));
            }
        } catch (error) {
            // Fail silently
        }
    }
    
    /**
     * Get device information
     */
    getDeviceInfo(): { deviceId: string; platform: string; nodeVersion: string } {
        return {
            deviceId: this.deviceId,
            platform: process.platform,
            nodeVersion: process.version
        };
    }
}

// Create singleton instance
export const localAnalytics = new LocalAnalytics();

// Convenience functions for common events
export const trackCommand = (command: string, args?: string[], sessionId?: string) => {
    localAnalytics.track('command_executed', { command, args }, sessionId);
};

export const trackSession = (sessionId: string, action: 'created' | 'joined' | 'left') => {
    localAnalytics.track(`session_${action}`, { sessionId });
};

export const trackError = (error: string, command?: string, sessionId?: string) => {
    localAnalytics.track('error_occurred', { error, command }, sessionId);
};

export const trackConnection = (status: 'connected' | 'disconnected' | 'failed', serverUrl?: string) => {
    localAnalytics.track(`connection_${status}`, { serverUrl });
};