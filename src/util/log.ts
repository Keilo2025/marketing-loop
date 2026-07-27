const useColor =
  process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb';

const wrap = (code: string) => (s: string) => (useColor ? `[${code}m${s}[0m` : s);

export const c = {
  bold: wrap('1'),
  dim: wrap('2'),
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  blue: wrap('34'),
  magenta: wrap('35'),
  cyan: wrap('36'),
  grey: wrap('90'),
};

export const log = {
  info: (msg: string) => console.log(msg),
  step: (msg: string) => console.log(`${c.cyan('›')} ${msg}`),
  ok: (msg: string) => console.log(`${c.green('✓')} ${msg}`),
  warn: (msg: string) => console.warn(`${c.yellow('!')} ${msg}`),
  err: (msg: string) => console.error(`${c.red('✗')} ${msg}`),
  dim: (msg: string) => console.log(c.grey(msg)),
  blank: () => console.log(''),
  title: (msg: string) => console.log(`\n${c.bold(msg)}`),
};

export function table(rows: Array<[string, string]>): void {
  const width = rows.reduce((m, r) => Math.max(m, r[0].length), 0);
  for (const [k, v] of rows) console.log(`  ${c.grey(k.padEnd(width))}  ${v}`);
}
