/**
 * Local SMTP "catcher" for offline testing when Ethereal isn't reachable.
 * Accepts any login and logs each received message. Not used in normal runs.
 *
 *   npm run smtp:local      # listens on 127.0.0.1:2525
 *   ETHEREAL_SENDERS='[{"email":"a@local.test","pass":"x","host":"127.0.0.1","port":2525}]'
 */
import { SMTPServer } from 'smtp-server';

const port = Number(process.env.LOCAL_SMTP_PORT ?? 2525);
let count = 0;

const server = new SMTPServer({
  authOptional: true,
  disabledCommands: ['STARTTLS'],
  onAuth(_auth, _session, cb) {
    cb(null, { user: 'local' });
  },
  onData(stream, session, cb) {
    let size = 0;
    stream.on('data', (c: Buffer) => (size += c.length));
    stream.on('end', () => {
      count++;
      console.log(
        `${new Date().toISOString()} #${count} from=${session.envelope.mailFrom && session.envelope.mailFrom.address} ` +
          `to=${session.envelope.rcptTo.map((r) => r.address).join(',')} bytes=${size}`,
      );
      cb();
    });
  },
});

server.listen(port, '127.0.0.1', () => console.log(`local SMTP catcher on 127.0.0.1:${port}`));
