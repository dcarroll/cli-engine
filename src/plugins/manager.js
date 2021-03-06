// @flow

import {type Config} from 'cli-engine-config'
import Command, {Topic} from 'cli-engine-command'
import type Output from 'cli-engine-command/lib/output'
import type Cache, {CachedPlugin, CachedCommand, CachedTopic} from './cache'
import {convertFlagsFromV5, type LegacyCommand} from './legacy'
import Namespaces from '../namespaces'
import path from 'path'

export type PluginType = | "builtin" | "core" | "user" | "link"

const debug = require('debug')('cli-engine:plugins:manager')

type ParsedTopic = | {
  name?: ?string,
  topic?: ?string,
  description?: ?string,
  hidden?: ?boolean
} | Class<Topic>

type ParsedCommand = | LegacyCommand | Class<Command<*>>

type ParsedPlugin = {
  topic?: ParsedTopic,
  topics?: ParsedTopic[],
  commands?: ParsedCommand[],
  namespace?: string
}

type PluginPathOptions = {
  output: Output,
  type: PluginType,
  path: string,
  tag?: string
}

export class PluginPath {
  constructor (options: PluginPathOptions) {
    this.out = options.output
    this.path = options.path
    this.type = options.type
    this.tag = options.tag

    this.config = this.out.config
  }

  out: Output
  config: Config
  path: string
  type: PluginType
  tag: string | void

  async convertToCached (): Promise<CachedPlugin> {
    let plugin: ParsedPlugin = await this.require()

    const getAliases = (c: ParsedCommand) => {
      let aliases = c.aliases || []
      if (c.default) {
        this.out.warn(`default setting on ${c.topic} is deprecated`)
        aliases.push(c.topic)
      }
      return aliases
    }

    if (!plugin.commands) throw new Error('no commands found')

    const commands: CachedCommand[] = plugin.commands
      .map(c => ({
        id: c.command ? `${c.topic}:${c.command}` : c.topic,
        topic: c.topic,
        command: c.command,
        description: c.description,
        args: c.args,
        variableArgs: c.variableArgs,
        help: c.help,
        usage: c.usage,
        hidden: !!c.hidden,
        aliases: getAliases(c),
        flags: convertFlagsFromV5(c.flags)
      }))
    const topics: CachedTopic[] = (plugin.topics || (plugin.topic ? [plugin.topic] : []))
      .map(t => ({
        topic: t.topic || t.name || '',
        description: t.description,
        hidden: !!t.hidden
      }))

    for (let command of commands) {
      if (topics.find(t => t.topic === command.topic)) continue
      topics.push({
        topic: command.topic,
        hidden: true
      })
    }

    const {name, version} = this.pjson()
    return {name, path: this.path, version, namespace: plugin.namespace, commands, topics}
  }

  undefaultTopic (t: (ParsedTopic | {default: ParsedTopic})): ParsedTopic {
    if (t.default) return (t.default: any)
    return t
  }

  undefaultCommand (c: (ParsedCommand | {default: ParsedCommand})): ParsedCommand {
    if (c.default && typeof c.default !== 'boolean') return (c.default: any)
    return (c: any)
  }

  async require (): Promise<ParsedPlugin> {
    let required
    try {
      required = require(this.path)
    } catch (err) {
      if (await this.repair(err)) return this.require()
      else throw err
    }
    let plugin = {
      topic: required.topic && this.undefaultTopic(required.topic),
      topics: required.topics && required.topics.map(this.undefaultTopic),
      commands: required.commands && required.commands.map(this.undefaultCommand),
      namespace: undefined
    }
    if (required.type === 'builtin' || /(\\|\/)(src|lib)(\\|\/)commands$/.test(this.path)) return plugin
    let {namespace} = Namespaces.metaData(this.path, this.config)
    if (namespace) plugin.namespace = namespace
    return plugin
  }

  pjson (): {name: string, version: string} {
    if (this.type === 'builtin') {
      return {name: 'builtin', version: this.config.version}
    }

    return require(path.join(this.path, 'package.json'))
  }

  async repair (err: Error): Promise<boolean> {
    debug(err)
    return false
  }
}

export class Manager {
  out: Output
  config: Config
  cache: Cache

  constructor ({out, config, cache}: {out: Output, config: Config, cache: Cache}) {
    this.out = out
    this.config = config
    this.cache = cache
  }

  async list (): Promise<PluginPath[]> {
    throw new Error('abstract method Manager.list')
  }

  async handleNodeVersionChange () {
    // user and linked will override
  }
}
