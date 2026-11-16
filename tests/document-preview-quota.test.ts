import { beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  connect: vi.fn(), update: vi.fn(), read: vi.fn(), file: vi.fn(), csv: vi.fn(),
  session: { admin: { id: 'admin-one' }, csrfToken: 'csrf' },
}))
vi.mock('../packages/database/src/index', () => ({ connectDatabase: mocks.connect, LoginAttemptModel: { updateOne: mocks.update } }))
vi.mock('../packages/core/src/index', () => ({ previewGuestsFile: mocks.file, previewGuestsCsv: mocks.csv, importGuestsFile: mocks.file, importGuestsCsv: mocks.csv }))
vi.mock('../apps/api/utils/admin', () => ({
  requireAdminOrigin: vi.fn(), requireAdmin: async () => mocks.session, requireCsrf: vi.fn(),
}))
vi.mock('../apps/api/utils/guest-import', async importOriginal => ({ ...await importOriginal<typeof import('../apps/api/utils/guest-import')>(), readGuestImportJson: mocks.read }))
import importGuests from '../apps/api/routes/admin/organizations/[id]/guests/import.post'
import preview from '../apps/api/routes/admin/organizations/[id]/guests/preview.post'

const event = { context: { params: { id: 'a'.repeat(24) } } } as any
beforeEach(() => {
  vi.resetAllMocks()
  mocks.session.admin.id = 'admin-one'
  mocks.file.mockResolvedValue({ rows: [] })
  mocks.csv.mockResolvedValue({ rows: [] })
  mocks.read.mockResolvedValue({ file: { name: 'lista.docx', contentBase64: Buffer.from('document').toString('base64') } })
  mocks.update.mockResolvedValue({ matchedCount: 1 })
})

test('quota documental esgotada devolve 429 antes do parser', async () => {
  mocks.update.mockResolvedValueOnce({ matchedCount: 1 }).mockResolvedValueOnce({ matchedCount: 0 })
  await expect(preview(event)).rejects.toMatchObject({ statusCode: 429 })
  expect(mocks.file).not.toHaveBeenCalled()
})

test('quota usa administrador, janela de um minuto e incremento condicional atômico', async () => {
  await preview(event)
  await preview({ context: { params: { id: 'b'.repeat(24) } } } as any)
  const [filter, update, options] = mocks.update.mock.calls[0]
  expect(filter._id).toMatch(/^guest-document-preview:[a-f0-9]{64}:\d+$/)
  expect(update.$setOnInsert).toMatchObject({ count: 0, expiresAt: expect.any(Date) })
  expect(options).toMatchObject({ upsert: true })
  expect(mocks.update.mock.calls[1]).toEqual([{ _id: filter._id, count: { $lt: 2 } }, { $inc: { count: 1 } }])
  expect(mocks.update.mock.calls[2][0]._id).toBe(filter._id)
  mocks.session.admin.id = 'admin-two'
  await preview(event)
  expect(mocks.update.mock.calls[4][0]._id).not.toBe(filter._id)
})

test.each(['connect', 'seed', 'increment'])('quota indisponível em %s bloqueia parser com 503', async stage => {
  if (stage === 'connect') mocks.connect.mockRejectedValueOnce(new Error('database down'))
  else if (stage === 'seed') mocks.update.mockRejectedValueOnce(new Error('database down'))
  else mocks.update.mockResolvedValueOnce({ matchedCount: 1 }).mockRejectedValueOnce(new Error('database down'))
  await expect(preview(event)).rejects.toMatchObject({ statusCode: 503 })
  expect(mocks.file).not.toHaveBeenCalled()
})

test.each(['lista.txt', 'lista.csv'])('arquivo %s continua disponível sem quota documental', async name => {
  mocks.connect.mockRejectedValue(new Error('quota down'))
  mocks.read.mockResolvedValue({ file: { name, contentBase64: Buffer.from('Ana;67999991111').toString('base64') } })
  await expect(preview(event)).resolves.toEqual({ rows: [] })
  expect(mocks.connect).not.toHaveBeenCalled()
})

test('CSV legado continua disponível sem quota documental', async () => {
  mocks.read.mockResolvedValue({ csv: 'name,phone\nAna,+5567999991111' })
  await expect(preview(event)).resolves.toEqual({ rows: [] })
  expect(mocks.connect).not.toHaveBeenCalled()
})

test('corrida na criação do contador não ignora o incremento condicional', async () => {
  mocks.update.mockRejectedValueOnce(Object.assign(new Error('duplicate'), { code: 11000 }))
  await expect(preview(event)).resolves.toEqual({ rows: [] })
  expect(mocks.update.mock.calls[1][0]).toMatchObject({ count: { $lt: 2 } })
})


test('importação DOC/DOCX também exige quota antes do parser', async () => {
  mocks.read.mockResolvedValue({ file: { name: 'lista.docx', contentBase64: Buffer.from('document').toString('base64') },
    acceptedRows: [1], batchId: 'aabbccdd-1122-4334-8a9b-ccddeeff0011' })
  mocks.update.mockResolvedValueOnce({ matchedCount: 1 }).mockResolvedValueOnce({ matchedCount: 0 })
  await expect(importGuests(event)).rejects.toMatchObject({ statusCode: 429 })
  expect(mocks.file).not.toHaveBeenCalled()
})
