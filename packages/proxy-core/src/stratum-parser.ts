import { Transform } from 'stream';
import { StratumMessage } from '@mining-proxy/shared-types';
import { Logger } from '@mining-proxy/logger';

const JsonParse = require('jsonparse');

/**
 * Streaming JSON parser for Stratum messages.
 * Does not modify data, only observes and emits parsed messages.
 */
export class StratumParser extends Transform {
  private parser: any;
  private onMessage: (message: StratumMessage) => void;
  private logger: Logger;

  constructor(onMessage: (message: StratumMessage) => void, logger: Logger) {
    super();
    this.onMessage = onMessage;
    this.logger = logger;
    this.parser = new JsonParse();

    this.parser.onValue = (value: any) => {
      if (this.parser.stack.length === 0) {
        // Top-level JSON object complete
        try {
          this.handleMessage(value);
        } catch (err) {
          // Ignore parse errors, continue forwarding
        }
      }
    };
  }

  _transform(chunk: Buffer, encoding: string, callback: () => void): void {
    try {
      this.parser.write(chunk);
    } catch (err) {
      // Malformed JSON - ignore and continue
      this.logger.error({err}, 'Malformed JSON');
    }
    // Pass through unchanged
    this.push(chunk);
    callback();
  }

  private handleMessage(obj: any): void {
    if (obj && typeof obj === 'object') {
      this.onMessage(obj as StratumMessage);
    }
  }
}
