import { v1 as uuidv1 } from 'uuid';
import IScriptInstanceMeta from '@secret-agent/core-interfaces/IScriptInstanceMeta';
import Log from '@secret-agent/commons/Logger';
import CoreSession from './CoreSession';

const { log } = Log(module);

export default class ScriptInstance {
  public readonly id: string = uuidv1();
  public readonly entrypoint: string = process.argv[1];
  public readonly startDate: string = new Date().toISOString();
  private sessionNameCountByName: { [name: string]: number } = {};

  public get meta(): IScriptInstanceMeta {
    return {
      id: this.id,
      entrypoint: this.entrypoint,
      startDate: this.startDate,
    };
  }

  public launchReplay(sessionName: string, coreSession: Promise<CoreSession>): void {
    // eslint-disable-next-line global-require
    const { replay } = require('@secret-agent/replay/index');
    coreSession
      .then(session => {
        return replay({
          scriptInstanceId: this.id,
          scriptStartDate: this.startDate,
          sessionsDataLocation: session.sessionsDataLocation,
          replayApiServer: session.replayApiServer,
          sessionId: session.sessionId,
          sessionName,
        });
      })
      .catch(err => {
        log.warn('Unable to connect to CoreTab', { error: err, sessionId: this.id });
      });
  }

  public generateSessionName(name: string, shouldCleanName = true): string {
    if (name && shouldCleanName) {
      name = cleanupSessionName(name);
    }
    name = name || 'default-session';

    this.sessionNameCountByName[name] = this.sessionNameCountByName[name] || 0;
    const countPlusOne = this.sessionNameCountByName[name] + 1;
    if (countPlusOne > 1) {
      const newName = `${name}-${countPlusOne}`;
      if (this.sessionNameCountByName[newName]) {
        return this.generateSessionName(newName, false);
      }
      this.sessionNameCountByName[name] += 1;
      return newName;
    }
    this.sessionNameCountByName[name] += 1;
    return name;
  }
}

function cleanupSessionName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gi, '-')
    .replace(/--/g, '')
    .replace(/^-|-$/g, '');
}
