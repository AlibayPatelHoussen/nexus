import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs/promises'
import { logger } from '../utils/logger'

const SCRIPTS_DIR = process.env.SCRIPTS_PATH || '/media/scripts'

export interface ScriptInfo {
  name:        string
  filename:    string
  path:        string
  description: string
  size:        number
  modified:    string
}

export class ScriptsService {
  static async list(): Promise<ScriptInfo[]> {
    try {
      const files = await fs.readdir(SCRIPTS_DIR)
      const scripts: ScriptInfo[] = []

      for (const file of files) {
        if (!file.endsWith('.py') && !file.endsWith('.sh')) continue
        const filePath = path.join(SCRIPTS_DIR, file)
        const stat     = await fs.stat(filePath)

        // Try to read first comment line as description
        let description = ''
        try {
          const content = await fs.readFile(filePath, 'utf8')
          const firstLine = content.split('\n').find((l) => l.startsWith('#'))
          description = firstLine?.replace(/^#+\s*/, '') || ''
        } catch { /* no description line */ }

        scripts.push({
          name:        path.basename(file, path.extname(file)),
          filename:    file,
          path:        filePath,
          description,
          size:        stat.size,
          modified:    stat.mtime.toISOString(),
        })
      }

      return scripts.sort((a, b) => a.name.localeCompare(b.name))
    } catch {
      return []
    }
  }

  static run(
    scriptName: string,
    onOutput: (data: string) => void,
    onExit:   (code: number) => void,
  ): () => void {
    const filePath = path.join(SCRIPTS_DIR, scriptName.endsWith('.py') ? scriptName : `${scriptName}.py`)

    const isShell = filePath.endsWith('.sh')
    const cmd     = isShell ? 'bash' : 'python3'
    const args    = [filePath]

    logger.info(`Running script: ${filePath}`)

    const proc = spawn(cmd, args, {
      cwd: SCRIPTS_DIR,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    })

    proc.stdout.on('data', (d) => onOutput(d.toString()))
    proc.stderr.on('data', (d) => onOutput(d.toString()))
    proc.on('close', (code) => {
      logger.info(`Script ${scriptName} exited with code ${code}`)
      onExit(code ?? 0)
    })

    // Return kill function
    return () => proc.kill()
  }
}
