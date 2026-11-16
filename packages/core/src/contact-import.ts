import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { guestInput, type GuestInput } from '@zingara/contracts'

export const CONTACT_FILE_BYTES = 256 * 1024
export const CONTACT_TEXT_BYTES = 64 * 1024
export type ContactRow = { line: number; guest?: GuestInput; errors: string[]; duplicates: string[] }
export type ContactFile = { name: string; contentBase64: string }

function normalizePhone(value: string) {
  const text = value.normalize('NFKC').trim()
  if (!/^\+?[\d\s().-]+$/.test(text)) return ''
  const digits = text.replace(/\D/g, '')
  if (text.startsWith('+')) return `+${digits}`
  if (digits.startsWith('00')) return `+${digits.slice(2)}`
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`
  return digits.startsWith('55') ? `+${digits}` : ''
}

function contactRow(line: number, value: Record<string, string>, extra = false): ContactRow {
  const name = (value.name ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ')
  const phone = normalizePhone(value.phone ?? '')
  const result = guestInput.safeParse({ name, phone,
    ...(value.email ? { email: value.email.trim() } : {}),
    tags: value.tags ? value.tags.split('|').map(tag => tag.trim()) : [],
    notes: value.notes ?? '', whatsappConsent: false,
  })
  const errors = extra ? ['Colunas excedentes.'] : []
  if ([...name].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) errors.push('Nome contém caracteres de controle.')
  if (!result.success) for (const issue of result.error.issues) {
    errors.push(issue.path[0] === 'phone' ? 'Telefone inválido. Use DDD e número ou formato internacional.' :
      issue.path[0] === 'name' ? 'Nome obrigatório, com até 120 caracteres.' : `Campo ${String(issue.path[0])} inválido.`)
  }
  return { line, ...(result.success ? { guest: result.data } : {}), errors, duplicates: [] }
}

function delimitedRows(text: string, delimiter: string) {
  const rows: { line: number; fields: string[] }[] = []
  let fields: string[] = [], field = '', quoted = false, closed = false, line = 1, start = 1
  const push = () => {
    fields.push(field)
    if (fields.some(value => value.trim())) rows.push({ line: start, fields })
    fields = []; field = ''; closed = false; start = line + 1
  }
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index++ }
      else if (char === '"') { quoted = false; closed = true }
      else { field += char; if (char === '\n') line++ }
    } else if (char === delimiter) { fields.push(field); field = ''; closed = false }
    else if (char === '\n') { push(); line++ }
    else if (char === '"' && !field && !closed) quoted = true
    else if (char === '"' || (closed && char.trim())) throw new SyntaxError('Arquivo com aspas inválidas.')
    else if (!closed) field += char
  }
  if (quoted) throw new SyntaxError('Arquivo com aspas não fechadas.')
  push()
  return rows
}

const aliases: Record<string, string> = { name: 'name', nome: 'name', phone: 'phone', telefone: 'phone', celular: 'phone', email: 'email', tags: 'tags', notas: 'notes', notes: 'notes' }
export function parseContactText(source: string, format: 'csv' | 'txt'): ContactRow[] {
  if (Buffer.byteLength(source, 'utf8') > CONTACT_TEXT_BYTES) throw new SyntaxError('Texto extraído ultrapassa 64 KiB.')
  if (source.includes('\0')) throw new SyntaxError('Arquivo de texto inválido. Use UTF-8.')
  const text = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const first = text.split('\n').find(line => line.trim()) ?? ''
  const delimiter = [';', '\t', ','].find(value => first.includes(value))
  const firstFields = delimiter ? first.split(delimiter).map(field => field.trim().toLowerCase()) : []
  const hasHeader = ['name', 'nome'].includes(firstFields[0] ?? '')
  let rows: ContactRow[]
  if (format === 'csv' || hasHeader) {
    if (!delimiter) throw new SyntaxError('Cabeçalho inválido. Use nome e telefone.')
    const records = delimitedRows(text, delimiter)
    const headers = records.shift()?.fields.map(value => aliases[value.trim().toLowerCase()]) ?? []
    if (headers[0] !== 'name' || headers[1] !== 'phone' || headers.some(value => !value) || new Set(headers).size !== headers.length) {
      throw new SyntaxError('Cabeçalho inválido. Use nome, telefone, email, tags e notas.')
    }
    rows = records.map(record => contactRow(record.line, Object.fromEntries(headers.map((header, index) => [header, record.fields[index] ?? ''])), record.fields.length > headers.length))
  } else {
    rows = text.split('\n').flatMap((value, index) => {
      if (!value.trim()) return []
      const match = value.match(/^(.+?)(?:\s*[,;\t|]\s*|\s+-\s+|\s+(?=\+|\(|\d))([+\d][\d\s().-]*|\([\d\s().-]+)$/)
      return [contactRow(index + 1, { name: match?.[1] ?? value.trim(), phone: match?.[2] ?? '' })]
    })
  }
  if (!rows.length || rows.length > 200) throw new SyntaxError('Arquivo deve ter de 1 a 200 contatos.')
  const seen = new Map<string, number>()
  for (const row of rows) {
    const phone = row.guest?.phone
    if (!phone || row.errors.length) continue
    if (seen.has(phone)) row.duplicates.push(`Telefone também na linha ${seen.get(phone)}.`)
    else seen.set(phone, row.line)
  }
  return rows
}

// The child receives only document bytes and package access, never application credentials.
const documentWorker = String.raw`
const { createRequire } = require('node:module');
const parserPath = process.argv[1];
const parserRequire = createRequire(parserPath);
const WordExtractor = require(parserPath);
const chunks = [];
process.stdin.on('data', chunk => chunks.push(chunk));
process.stdin.on('end', async () => {
  try {
    const input = Buffer.concat(chunks);
    if (input[0] === 0xd0) {
      if (input.length < 512 || ![9, 12].includes(input.readUInt16LE(30)) || input.readUInt16LE(32) !== 6) throw new Error('sector size');
      const sectorBytes = 1 << input.readUInt16LE(30);
      const sectorCount = Math.floor(input.length / sectorBytes) - 1;
      for (const offset of [44, 64, 72]) if (input.readUInt32LE(offset) > sectorCount) throw new Error('sector count');
      const AllocationTable = parserRequire('./ole-allocation-table');
      AllocationTable.prototype.getSecIdChain = function(start) {
        const chain = [], seen = new Set();
        let id = start;
        while (id >= 0) {
          if (!Number.isInteger(id) || id >= this._table.length || seen.has(id) || chain.length >= input.length / 64) throw new Error('sector chain');
          seen.add(id); chain.push(id); id = this._table[id];
        }
        if (id !== -1 && id !== -2) throw new Error('sector end');
        return chain;
      };
      const CompoundDocument = parserRequire('./ole-compound-doc');
      for (const [method, bytes] of [['_readSectors', sectorBytes], ['_readShortSectors', 64]]) {
        const original = CompoundDocument.prototype[method];
        CompoundDocument.prototype[method] = function(ids) {
          if (ids.length * bytes > input.length) throw new Error('stream size');
          return original.call(this, ids);
        };
      }
    }
    if (input[0] === 0x50) {
      const yauzl = parserRequire('yauzl');
      await new Promise((resolve, reject) => yauzl.fromBuffer(input, {lazyEntries: true}, (error, zip) => {
        if (error) return reject(error);
        let count = 0, size = 0;
        zip.on('error', reject);
        zip.on('entry', entry => {
          size += entry.uncompressedSize;
          if (++count > 100 || size > 1048576 || entry.generalPurposeBitFlag & 1 || /vbaProject|embeddings\//i.test(entry.fileName)) {
            zip.close(); reject(new Error('limits')); return;
          }
          zip.readEntry();
        });
        zip.on('end', resolve);
        zip.readEntry();
      }));
    }
    const document = await new WordExtractor().extract(input);
    const text = document.getBody();
    if (Buffer.byteLength(text, 'utf8') > 65536) throw new Error('size');
    process.stdout.write(text);
  } catch { process.exitCode = 1; }
});
`
let activeDocuments = 0
async function extractDocument(buffer: Buffer): Promise<string> {
  if (activeDocuments >= 2) throw new SyntaxError('Análise de documentos ocupada. Tente novamente.')
  activeDocuments++
  try {
    // Playwright uses CJS; production ESM resolves from the API entry point.
    const lookupDirectory = typeof __dirname === 'string' ? __dirname : dirname(resolve(process.argv[1] || 'package.json'))
    const parserPath = createRequire(resolve(process.cwd(), 'package.json')).resolve('word-extractor', {
      paths: [lookupDirectory, resolve(process.cwd(), 'packages/core'), process.cwd()],
    })
    const modulesDirectory = parserPath.slice(0, parserPath.indexOf('/node_modules/') + '/node_modules'.length)
    return await new Promise<string>((resolve, reject) => {
      const child = execFile(process.execPath, ['--max-old-space-size=64', '--permission', `--allow-fs-read=${modulesDirectory}`, '-e', documentWorker, parserPath],
        { timeout: 10000, killSignal: 'SIGKILL', maxBuffer: CONTACT_TEXT_BYTES, env: { NODE_ENV: 'production' }, encoding: 'utf8' },
        (error, stdout) => error ? reject(new SyntaxError('Documento inválido, protegido ou fora dos limites. Converta para CSV ou TXT.')) : resolve(stdout))
      child.stdin?.on('error', () => { /* Rejection is handled by the process callback. */ })
      child.stdin?.end(buffer)
    })
  } finally { activeDocuments-- }
}

export async function parseContactFile(file: ContactFile): Promise<ContactRow[]> {
  const extension = file.name.toLowerCase().match(/\.([a-z]+)$/)?.[1]
  if (!['csv', 'txt', 'docx', 'doc'].includes(extension ?? '')) throw new SyntaxError('Formato não suportado. Use CSV, TXT, DOCX ou DOC.')
  if (file.contentBase64.length > Math.ceil(CONTACT_FILE_BYTES / 3) * 4) throw new SyntaxError('Arquivo ultrapassa 256 KiB.')
  const buffer = Buffer.from(file.contentBase64, 'base64')
  if (!buffer.length || buffer.length > CONTACT_FILE_BYTES || buffer.toString('base64') !== file.contentBase64) throw new SyntaxError('Conteúdo do arquivo inválido.')
  if (extension === 'doc' || extension === 'docx') {
    const signature = extension === 'doc' ? 'd0cf11e0a1b11ae1' : '504b0304'
    if (!buffer.subarray(0, signature.length / 2).equals(Buffer.from(signature, 'hex'))) throw new SyntaxError('Formato do documento não corresponde à extensão.')
    // Word tables end each row with a cell separator, which is not an extra CSV column.
    return parseContactText((await extractDocument(buffer)).replace(/\t(?=\r?\n|$)/g, ''), 'txt')
  }
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer) }
  catch { throw new SyntaxError('Arquivo de texto inválido. Use UTF-8.') }
  return parseContactText(text, extension === 'csv' ? 'csv' : 'txt')
}
