// @flow

import path from 'path'
import AutocompleteBase from '.'
import Output from 'cli-engine-command/lib/output'
import {type Config} from 'cli-engine-config'
import fs from 'fs-extra'
import Plugins from '../../plugins'
import {convertFromV5} from '../../plugins/legacy'

export default class AutocompleteScript extends AutocompleteBase {
  static topic = 'autocomplete'
  static command = 'script'
  static description = 'outputs autocomplete config script for shells'
  // hide until beta release
  static hidden = true
  static args = [{name: 'shell', description: 'shell type', required: false}]

  async run () {
    this.errorIfWindows()
    await AutocompleteScript.generateAutocompleteCommands(this)

    const shell = this.argv[0] || this.config.shell
    if (!shell) {
      this.out.error('Error: Missing required argument shell')
    }

    switch (shell) {
      case 'zsh':
        this.out.log(`fpath=(
  ${path.join(this.functionsPath, 'zsh')}
  $fpath
);
autoload -Uz compinit;
compinit;`)
        break
      default:
        this.out.error(`Currently ${shell} is not a supported shell for autocomplete`)
    }
  }

  static async generateAutocompleteCommands ({config, out}: {config: Config, out: Output}) {
    const flatten = require('lodash.flatten')
    try {
      // TODO: move from cli to client dir if not already present
      // if (!fs.pathExistsSync(path.join(this.config.dataDir, 'client', 'autocomplete', 'bash', 'heroku'))) {
      //   const cli = path.join(this.config.dataDir, 'cli', 'autocomplete')
      //   const client = path.join(this.config.dataDir, 'client', 'autocomplete')
      //   fs.copySync(cli, client)
      // }
      const plugins = await new Plugins(out).list()
      const cmds = await Promise.all(plugins.map(async (p) => {
        const hydrated = await p.pluginPath.require()
        const cmds = hydrated.commands || []
        return cmds.filter(c => !c.hidden).map(c => {
          const Command = typeof c === 'function' ? c : convertFromV5((c: any))
          const publicFlags = Object.keys(Command.flags || {}).filter(flag => !Command.flags[flag].hidden).map(flag => `--${flag}`).join(' ')
          const flags = publicFlags.length ? ` ${publicFlags}` : ''
          const namespace = p.namespace ? `${p.namespace}:` : ''
          const id = Command.command ? `${Command.topic}:${Command.command}` : Command.topic
          return `${namespace}${id}${flags}`
        })
      }))
      const commands = flatten(cmds).join('\n')
      fs.writeFileSync(path.join((new this().completionsPath), 'commands'), commands)
    } catch (e) {
      out.debug('Error creating autocomplete commands')
      out.debug(e.message)
    }
  }
}