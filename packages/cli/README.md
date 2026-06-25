# logsesh

read and export ai coding agent session logs. local-first, no telemetry.

## install

```bash
npm install -g logsesh
```

## usage

```bash
logsesh list
logsesh search "middleware" --project myapp
logsesh stats --since 30d
logsesh export --format markdown --out session.md --redact
```

requires node `>=22`.

## license

MIT
