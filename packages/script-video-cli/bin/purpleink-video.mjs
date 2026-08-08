#!/usr/bin/env node
import { tsImport } from 'tsx/esm/api'

const module = await tsImport('../src/cli.ts', import.meta.url)
process.exitCode = await module.runCli()
