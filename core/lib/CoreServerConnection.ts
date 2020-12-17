import IConfigureSessionOptions from '@secret-agent/core-interfaces/IConfigureSessionOptions';
import ISessionMeta from '@secret-agent/core-interfaces/ISessionMeta';
import { IJsPath } from 'awaited-dom/base/AwaitedPath';
import ICreateSessionOptions from '@secret-agent/core-interfaces/ICreateSessionOptions';
import { TypedEventEmitter } from '@secret-agent/commons/eventUtils';
import ICoreRequestPayload from '@secret-agent/core-interfaces/ICoreRequestPayload';
import ICoreResponsePayload from '@secret-agent/core-interfaces/ICoreResponsePayload';
import ICoreConfigureOptions from '@secret-agent/core-interfaces/ICoreConfigureOptions';
import ICoreEventPayload from '@secret-agent/core-interfaces/ICoreEventPayload';
import Session from './Session';
import Tab from './Tab';
import GlobalPool from './GlobalPool';
import Core from '../index';
import UserProfile from './UserProfile';
import BrowserEmulators from './BrowserEmulators';

export default class CoreServerConnection extends TypedEventEmitter<{
  close: { fatalError?: Error };
  message: ICoreResponsePayload | ICoreEventPayload;
}> {
  public isClosing = false;
  public isPersistent = false;
  public autoShutdownMillis = 500;

  private autoShutdownTimer: NodeJS.Timer;
  private readonly sessionIds = new Set<string>();

  ///////  CORE SERVER CONNECTION  /////////////////////////////////////////////////////////////////////////////////////

  public async handleRequest(payload: ICoreRequestPayload): Promise<void> {
    const { messageId, command, meta, args } = payload;

    let data: any;
    let isError = false;
    try {
      if (command in this) {
        if (meta) {
          data = await this[command](meta, ...args);
        } else {
          data = await this[command](...args);
        }
      } else {
        // if not on this function, assume we're sending on to tab
        const tab = Session.getTab(meta);
        if (typeof tab[command] === 'function') {
          data = await tab[command](...args);
        } else {
          isError = true;
          data = new Error(`Command not available on tab (${command} - ${typeof tab[command]})`);
        }
      }
    } catch (error) {
      isError = true;
      data =
        error instanceof Error
          ? {
              message: error.message,
              stack: error.stack,
              ...error,
            }
          : new Error(`Unknown error occurred ${error}`);
    }

    let commandId: number;
    if (meta?.sessionId) {
      commandId = Session.get(meta.sessionId)?.sessionState?.lastCommand?.id;
    }

    const response: ICoreResponsePayload = {
      responseId: messageId,
      commandId,
      data,
      isError,
    };
    this.emit('message', response);
  }

  public async connect(
    options: ICoreConfigureOptions & { isPersistent?: boolean } = {},
  ): Promise<{ maxConcurrency: number; browserEmulatorIds: string[] }> {
    this.isPersistent = options.isPersistent ?? false;
    this.isClosing = false;
    await Core.start(options, false);
    return {
      maxConcurrency: GlobalPool.maxConcurrentAgentsCount,
      browserEmulatorIds: BrowserEmulators.emulatorIds,
    };
  }

  public async logUnhandledError(error: Error, fatalError = false): Promise<void> {
    await Core.logUnhandledError(error, fatalError);
  }

  public async disconnect(fatalError?: Error): Promise<void> {
    if (this.isClosing) return;
    this.isClosing = true;
    clearTimeout(this.autoShutdownTimer);
    const closeAll: Promise<any>[] = [];
    for (const id of this.sessionIds) {
      const promise = Session.get(id)?.close();
      if (promise) closeAll.push(promise);
    }
    await Promise.all(closeAll);
    this.isPersistent = false;
    this.emit('close', { fatalError });
  }

  public isActive() {
    return this.sessionIds.size > 0 || this.isPersistent;
  }

  ///////  SESSION /////////////////////////////////////////////////////////////////////////////////////////////////////

  public getTabs(meta: ISessionMeta): Promise<ISessionMeta[]> {
    const session = Session.get(meta.sessionId);
    return Promise.all(session.tabs.filter(x => !x.isClosing).map(x => this.getSessionMeta(x)));
  }

  public async exportUserProfile(meta: ISessionMeta) {
    const session = Session.get(meta.sessionId);
    return await UserProfile.export(session);
  }

  public async createSession(options: ICreateSessionOptions = {}): Promise<ISessionMeta> {
    if (this.isClosing) throw new Error('Connection closed');
    clearTimeout(this.autoShutdownTimer);
    const session = await GlobalPool.createSession(options);
    this.sessionIds.add(session.id);
    session.on('awaited-event', this.emit.bind(this, 'message'));
    session.on('closing', () => this.sessionIds.delete(session.id));
    session.on('closed', this.checkForAutoShutdown.bind(this));

    const tab = await session.createTab();
    return this.getSessionMeta(tab);
  }

  public async closeSession(sessionMeta: ISessionMeta): Promise<void> {
    await Session.get(sessionMeta.sessionId)?.close();
  }

  public configure(sessionMeta: ISessionMeta, options: IConfigureSessionOptions): Promise<void> {
    const session = Session.get(sessionMeta.sessionId);
    return session.configure(options);
  }

  public async waitForNewTab(sessionMeta: ISessionMeta): Promise<ISessionMeta> {
    const tab = Session.getTab(sessionMeta);
    const newTab = await tab.waitForNewTab();
    return this.getSessionMeta(newTab);
  }

  public addEventListener(
    sessionMeta: ISessionMeta,
    jsPath: IJsPath,
    type: string,
  ): { listenerId: string } {
    const session = Session.get(sessionMeta.sessionId);
    return session.awaitedEventListener.listen(sessionMeta, jsPath, type);
  }

  public removeEventListener(sessionMeta: ISessionMeta, id: string): void {
    const session = Session.get(sessionMeta.sessionId);
    session.awaitedEventListener.remove(id);
  }

  private checkForAutoShutdown(): void {
    if (this.isActive()) return;
    clearTimeout(this.autoShutdownTimer);
    this.autoShutdownTimer = setTimeout(() => {
      if (this.isActive()) return;
      return this.disconnect();
    }, this.autoShutdownMillis).unref();
  }

  private async getSessionMeta(tab: Tab): Promise<ISessionMeta> {
    const session = tab.session;
    return {
      sessionId: session.id,
      sessionsDataLocation: session.baseDir,
      tabId: tab.id,
      replayApiServer: (await Core.replayServer)?.url,
    };
  }
}
