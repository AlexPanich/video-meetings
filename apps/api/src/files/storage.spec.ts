import { isAbsolute } from 'node:path'
import { getMaxUploadSize, getUploadsDir } from './storage.js'

describe('storage', () => {
  const env = { ...process.env }
  afterEach(() => {
    process.env = { ...env }
  })

  it('каталог по умолчанию лежит в apps/api независимо от cwd', () => {
    delete process.env.UPLOADS_DIR
    const dir = getUploadsDir()
    expect(isAbsolute(dir)).toBe(true)
    expect(dir.endsWith('/apps/api/uploads')).toBe(true)
  })

  it('относительный UPLOADS_DIR считается от apps/api, абсолютный остаётся как есть', () => {
    process.env.UPLOADS_DIR = './data'
    expect(getUploadsDir().endsWith('/apps/api/data')).toBe(true)
    process.env.UPLOADS_DIR = '/var/uploads'
    expect(getUploadsDir()).toBe('/var/uploads')
  })

  it('лимит размера: значение из env, дефолт при мусоре, потолок — Int32', () => {
    delete process.env.MAX_UPLOAD_BYTES
    expect(getMaxUploadSize()).toBe(500 * 1024 * 1024)
    process.env.MAX_UPLOAD_BYTES = '1024'
    expect(getMaxUploadSize()).toBe(1024)
    process.env.MAX_UPLOAD_BYTES = 'abc'
    expect(getMaxUploadSize()).toBe(500 * 1024 * 1024)
    process.env.MAX_UPLOAD_BYTES = '99999999999'
    expect(getMaxUploadSize()).toBe(2_147_483_647)
  })
})
