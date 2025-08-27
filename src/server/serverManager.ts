/**
 * Server Management Utilities
 * Handles automatic server startup, health checking, and process management
 */

import { spawn, ChildProcess } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';

interface ServerConfig {
    databaseUrl: string;
    redisUrl: string;
    masterSecret: string;
    port: number;
    serverPath?: string; // Path to happy-server directory
}

export class ServerManager {
    private pidFile: string;
    private logFile: string;
    private serverProcess: ChildProcess | null = null;

    constructor() {
        this.pidFile = path.join(configuration.happyHomeDir, 'server.pid');
        this.logFile = path.join(configuration.happyHomeDir, 'logs', 'server.log');
    }

    /**
     * Check if server is running and healthy
     */
    async isServerRunning(serverUrl: string = 'http://localhost:3005'): Promise<boolean> {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 3000);

            const response = await fetch(`${serverUrl}/`, {
                method: 'GET',
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            return response.ok;
        } catch (error) {
            logger.debug(`Server health check failed: ${error}`);
            return false;
        }
    }

    /**
     * Get the process ID of running server from PID file
     */
    async getServerPid(): Promise<number | null> {
        try {
            const pidStr = await fs.readFile(this.pidFile, 'utf-8');
            const pid = parseInt(pidStr.trim());
            
            // Check if process is actually running
            if (this.isProcessRunning(pid)) {
                return pid;
            } else {
                // Clean up stale PID file
                await fs.unlink(this.pidFile).catch(() => {});
                return null;
            }
        } catch (error) {
            return null;
        }
    }

    /**
     * Check if a process ID is running
     */
    private isProcessRunning(pid: number): boolean {
        try {
            // On Unix, signal 0 tests if process exists without affecting it
            process.kill(pid, 0);
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Find the happy-server directory relative to CLI
     */
    private async findServerPath(): Promise<string | null> {
        const possiblePaths = [
            // If CLI and server are siblings
            path.resolve(__dirname, '../../../happy-server'),
            // If CLI is inside server
            path.resolve(__dirname, '../../../'),
            // If server is inside CLI (unlikely)
            path.resolve(__dirname, '../../happy-server'),
            // Environment variable override
            process.env.HAPPY_SERVER_PATH
        ].filter(Boolean);

        for (const serverPath of possiblePaths) {
            try {
                const packageJsonPath = path.join(serverPath!, 'package.json');
                const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
                
                // Verify this is the happy-server by checking package name
                if (packageJson.name === 'happy-server' || packageJson.scripts?.start) {
                    logger.debug(`Found server at: ${serverPath}`);
                    return serverPath!;
                }
            } catch (error) {
                // Continue searching
            }
        }

        return null;
    }

    /**
     * Start the server daemon in background
     */
    async startServer(config: ServerConfig): Promise<boolean> {
        try {
            logger.debug('Starting Happy server...');

            // Find server directory
            const serverPath = config.serverPath || await this.findServerPath();
            if (!serverPath) {
                logger.debug('Could not find happy-server directory');
                return false;
            }

            // Ensure logs directory exists
            await fs.mkdir(path.dirname(this.logFile), { recursive: true });

            // Prepare environment variables
            const env = {
                ...process.env,
                DATABASE_URL: config.databaseUrl,
                REDIS_URL: config.redisUrl,
                HANDY_MASTER_SECRET: config.masterSecret,
                PORT: config.port.toString(),
                NODE_ENV: process.env.NODE_ENV || 'development'
            };

            // Start server process
            this.serverProcess = spawn('yarn', ['start'], {
                cwd: serverPath,
                env,
                detached: true,
                stdio: ['ignore', 'pipe', 'pipe']
            });

            // Handle server output
            if (this.serverProcess.stdout) {
                this.serverProcess.stdout.on('data', (data) => {
                    this.appendToLogFile(`[STDOUT] ${data.toString()}`);
                });
            }

            if (this.serverProcess.stderr) {
                this.serverProcess.stderr.on('data', (data) => {
                    this.appendToLogFile(`[STDERR] ${data.toString()}`);
                });
            }

            // Save PID
            if (this.serverProcess.pid) {
                await fs.writeFile(this.pidFile, this.serverProcess.pid.toString());
                logger.debug(`Server started with PID: ${this.serverProcess.pid}`);
            }

            // Wait for server to be ready
            const ready = await this.waitForServerReady(`http://localhost:${config.port}`);
            
            if (ready) {
                logger.debug('Server is ready and healthy');
                // Detach the process so it continues running after CLI exits
                this.serverProcess.unref();
                return true;
            } else {
                logger.debug('Server failed to start properly');
                await this.stopServer();
                return false;
            }

        } catch (error) {
            logger.debug(`Failed to start server: ${error}`);
            return false;
        }
    }

    /**
     * Wait for server to be ready by polling health endpoint
     */
    private async waitForServerReady(serverUrl: string, timeout: number = 15000): Promise<boolean> {
        const startTime = Date.now();
        
        while (Date.now() - startTime < timeout) {
            if (await this.isServerRunning(serverUrl)) {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        return false;
    }

    /**
     * Stop the server daemon
     */
    async stopServer(): Promise<boolean> {
        try {
            const pid = await this.getServerPid();
            if (pid) {
                logger.debug(`Stopping server with PID: ${pid}`);
                process.kill(pid, 'SIGTERM');
                
                // Wait a bit for graceful shutdown
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Force kill if still running
                if (this.isProcessRunning(pid)) {
                    logger.debug('Force killing server');
                    process.kill(pid, 'SIGKILL');
                }
            }

            // Clean up PID file
            await fs.unlink(this.pidFile).catch(() => {});
            
            return true;
        } catch (error) {
            logger.debug(`Error stopping server: ${error}`);
            return false;
        }
    }

    /**
     * Ensure server is running, start if needed
     */
    async ensureServerRunning(config?: Partial<ServerConfig>): Promise<boolean> {
        const serverUrl = `http://localhost:${config?.port || 3005}`;
        
        // Check if already running
        if (await this.isServerRunning(serverUrl)) {
            logger.debug('Server is already running and healthy');
            return true;
        }

        // Start server with default config
        const defaultConfig: ServerConfig = {
            databaseUrl: `postgresql://${process.env.USER || 'postgres'}@localhost:5432/happy?schema=public`,
            redisUrl: "redis://localhost:6380",
            masterSecret: "development-secret-key-please-change-in-production",
            port: 3005,
            ...config
        };

        console.log('🔧 Starting Happy server...');
        const started = await this.startServer(defaultConfig);
        
        if (started) {
            console.log('✅ Happy server started successfully');
            return true;
        } else {
            console.error('❌ Failed to start Happy server');
            return false;
        }
    }

    /**
     * Append text to log file
     */
    private async appendToLogFile(text: string): Promise<void> {
        try {
            const timestamp = new Date().toISOString();
            const logEntry = `[${timestamp}] ${text}`;
            await fs.appendFile(this.logFile, logEntry);
        } catch (error) {
            // Ignore log file errors
        }
    }
}

// Singleton instance
export const serverManager = new ServerManager();