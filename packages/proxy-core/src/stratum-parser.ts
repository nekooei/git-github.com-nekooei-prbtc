import { StratumMessage } from '@mining-proxy/shared-types';
import { Logger } from '@mining-proxy/logger';

/**
 * Line-based JSON parser for Stratum messages (newline-delimited JSON-RPC).
 * Does not modify data, only observes and emits parsed messages.
 * Resilient to non-JSON data and protocol mismatches.
 */
export class StratumParser {
  private buffer: string = '';
  private onMessage: (message: StratumMessage) => void;
  private logger: Logger;
  private nonJsonWarned = false;

  constructor(onMessage: (message: StratumMessage) => void, logger: Logger) {
    this.onMessage = onMessage;
    this.logger = logger;
  }

  write(chunk: Buffer): void {
    // Try to parse for metrics (best effort)
    try {
      // Append to buffer and split by newlines
      this.buffer += chunk.toString('utf-8');
      const lines = this.buffer.split('\n');
      
      // Keep the last incomplete line in buffer
      this.buffer = lines.pop() || '';

      // Process complete lines
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;

        try {
          const obj = JSON.parse(trimmed);
          this.handleMessage(obj);
        } catch (err) {
          // Not valid JSON - might be binary Stratum data, HTTP, or other protocol
          // We forward everything anyway, so just log at debug level
          if (!this.nonJsonWarned) {
            const isHttp = trimmed.startsWith('GET ') || trimmed.startsWith('POST ') || trimmed.startsWith('HTTP/');
            if (isHttp) {
              this.logger.info(
                { preview: trimmed.substring(0, 50) },
                'HTTP request detected on Stratum port (wrong protocol)'
              );
            } else {
              this.logger.debug(
                { preview: trimmed.substring(0, 50) },
                'Non-JSON line detected (may be binary Stratum data)'
              );
            }
            this.nonJsonWarned = true;
          }
        }
      }

      // Reset buffer if it gets too large (prevent memory leak from non-JSON streams)
      if (this.buffer.length > 65536) {
        this.logger.warn('Parser buffer overflow, resetting (likely not a Stratum connection)');
        this.buffer = '';
      }
    } catch (err) {
      // UTF-8 decode error or other unexpected issue
      this.logger.debug({ err }, 'Parser error, continuing');
      this.buffer = ''; // Reset on error
    }
  }

  private handleMessage(obj: any): void {
    if (obj && typeof obj === 'object') {
      this.onMessage(obj as StratumMessage);
    }
  }
}
