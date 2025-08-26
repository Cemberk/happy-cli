import { encodeBase64 } from './encryption';

/**
 * Generate a URL for local web authentication (privacy-first)
 * @param publicKey - The ephemeral public key to include in the URL
 * @returns The local web authentication URL
 */
export function generateWebAuthUrl(publicKey: Uint8Array): string {
    const publicKeyBase64 = encodeBase64(publicKey, 'base64url');
    // Privacy-first: Use local Happy web app instead of external service
    return `http://localhost:8081/terminal/connect#key=${publicKeyBase64}`;
}