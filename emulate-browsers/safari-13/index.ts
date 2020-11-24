import { URL } from 'url';
import INetworkInterceptorDelegate from '@secret-agent/core-interfaces/INetworkInterceptorDelegate';
import {
  BrowserEmulatorClassDecorator,
  DomOverridesBuilder,
  getEngineExecutablePath,
  getTcpSettingsForOs,
  IUserAgent,
  modifyHeaders,
  parseNavigatorPlugins,
  StatcounterBrowserUsage,
  UserAgents,
} from '@secret-agent/emulate-browsers-base';
import {
  canonicalDomain,
  Cookie,
  CookieJar,
  domainMatch,
  getPublicSuffix,
  permuteDomain,
} from 'tough-cookie';
import SameSiteContext from '@secret-agent/commons/interfaces/SameSiteContext';
import IHttpResourceLoadDetails from '@secret-agent/core-interfaces/IHttpResourceLoadDetails';
import IResolvablePromise from '@secret-agent/core-interfaces/IResolvablePromise';
import { createPromise, pickRandom } from '@secret-agent/commons/utils';
import { randomBytes } from 'crypto';
import IUserProfile from '@secret-agent/core-interfaces/IUserProfile';
import pkg from './package.json';
import headerProfiles from './data/headers.json';
import defaultAgents from './data/user-agents.json';
import codecs from './data/codecs.json';
import frame from './data/frame.json';
import navigator from './data/navigator.json';

// NOTE: runs on Chrome83 since we don't support webkit yet
const agents = UserAgents.getSupportedAgents('Chrome', 83, defaultAgents);
const cookieCallbackName = 'SecretAgentSetCookie';

@BrowserEmulatorClassDecorator
export default class Safari13 {
  public static id = pkg.name;
  public static roundRobinPercent = StatcounterBrowserUsage.getConsumerUsageForBrowser(
    'Safari 13.1',
  );

  public static engine = {
    ...pkg.engine,
    executablePath: process.env.CHROME_83_BIN ?? getEngineExecutablePath(pkg.engine),
  };

  public readonly userAgent: IUserAgent;
  public readonly networkInterceptorDelegate: INetworkInterceptorDelegate;

  public set locale(value: string) {
    this._locale = value;
    this.hasCustomLocale = true;
  }

  public get locale() {
    return this._locale;
  }

  public cookieJar = new CookieJar(null, { rejectPublicSuffixes: false });
  // track sites per safari ITP that are considered to have "first party user interaction"
  public sitesWithUserInteraction: string[] = [];
  // This Flag Should be enabled once double agent deciphers patch level changes
  public enableNov2019ITPSupport = false;

  public enableFeb2020ITPSupport = false;

  public cookiesPendingSiteInteraction: {
    [site: string]: { cookie: Cookie; sourceUrl: string; sameSiteContext: SameSiteContext }[];
  } = {};

  public get canPolyfill() {
    return false;
  }

  public get userProfile(): IUserProfile {
    return this._userProfile;
  }

  public set userProfile(userProfile: IUserProfile) {
    this._userProfile = userProfile;
    if (userProfile.cookies) {
      this.loadProfileCookies();
    }
  }

  protected domOverrides = new DomOverridesBuilder();
  private _userProfile: IUserProfile;

  private _locale = 'en-US';
  private hasCustomLocale = false;

  private readonly userInteractionTrigger: {
    [site: string]: IResolvablePromise;
  } = {};

  constructor(userAgent?: IUserAgent) {
    this.userAgent = userAgent ?? pickRandom(agents);
    this.networkInterceptorDelegate = {
      tcp: getTcpSettingsForOs(this.userAgent.os),
      tls: {
        emulatorProfileId: 'Safari13',
      },
      http: {
        requestHeaders: modifyHeaders.bind(this, this.userAgent, headerProfiles, this.hasCustomLocale),
        cookieHeader: this.getCookieHeader.bind(this),
        onSetCookie: this.setCookie.bind(this),
        onOriginHasFirstPartyInteraction: this.documentHasUserActivity.bind(this),
      },
    };
    this.loadDomOverrides();
  }

  public async newDocumentInjectedScripts() {
    const result = this.domOverrides.build();
    Object.assign(result[0], {
      callback: ({ cookie, origin }) => {
        this.cookieJar.setCookie(cookie, origin);
      },
      callbackWindowName: cookieCallbackName,
    });
    return result;
  }

  protected loadDomOverrides() {
    const domOverrides = this.domOverrides;
    domOverrides.add('Error.captureStackTrace');
    domOverrides.add('Error.constructor');

    domOverrides.add('navigator.webdriver');

    const deviceMemory = Math.ceil(Math.random() * 4) * 2;
    domOverrides.add('navigator.deviceMemory', { memory: deviceMemory });

    domOverrides.add('MediaDevices.prototype.enumerateDevices', {
      videoDevice: {
        deviceId: randomBytes(32).toString('hex'),
        groupId: randomBytes(32).toString('hex'),
      },
    });

    domOverrides.add('Notification.permission');
    domOverrides.add('Permission.prototype.query');

    domOverrides.add('navigator.plugins', parseNavigatorPlugins(navigator.navigator));
    domOverrides.add('WebGLRenderingContext.prototype.getParameter', {
      // UNMASKED_VENDOR_WEBGL
      37445: 'Intel Inc.',
      // UNMASKED_RENDERER_WEBGL
      37446: 'Intel Iris OpenGL Engine',
    });
    domOverrides.add('console.debug');

    domOverrides.add('Element.prototype.attachShadow');

    domOverrides.add('window.outerWidth');

    const windowFrame = this.getFrameHeight();
    if (windowFrame) {
      domOverrides.add('window.outerHeight', {
        windowFrame,
      });
    }

    const agentCodecs = this.getCodecs();
    if (agentCodecs) {
      domOverrides.add('HTMLMediaElement.prototype.canPlayType', {
        audioCodecs: agentCodecs.audioSupport,
        videoCodecs: agentCodecs.videoSupport,
      });
      domOverrides.add('MediaRecorder.isTypeSupported', {
        supportedCodecs: agentCodecs.audioSupport.recordingFormats.concat(
          agentCodecs.videoSupport.recordingFormats,
        ),
      });
      domOverrides.add('RTCRtpSender.getCapabilities', {
        videoCodecs: agentCodecs.webRtcVideoCodecs,
        audioCodecs: agentCodecs.webRtcAudioCodecs,
      });
    }

    domOverrides.add('Document.prototype.cookie', {
      callbackName: cookieCallbackName,
    });
  }

  private getFrameHeight() {
    const os = this.userAgent.os;
    const osFamilyLower = os.family.match(/mac/i) ? 'mac-os-x' : 'windows';
    return frame[osFamilyLower] ?? frame[`${osFamilyLower}-${os.major}`];
  }

  private getCodecs() {
    const os = this.userAgent.os;
    let osCodecs = codecs.find(x => x.opSyses.includes(`${os.family} ${os.major}`));
    if (!osCodecs) {
      // just match on os
      osCodecs = codecs.find(x => x.opSyses.some(y => y.includes(os.family)));
    }
    return osCodecs?.profile;
  }

  private loadProfileCookies() {
    const originUrls = (Object.keys(this.userProfile.storage ?? {}) ?? []).map(x => new URL(x));
    const cookies = this.userProfile.cookies;
    for (const cookie of cookies) {
      let url = `http${cookie.secure ? 's' : ''}://${cookie.domain}${cookie.path}`;
      const match = originUrls.find(x => {
        return x.hostname.endsWith(cookie.domain);
      });
      if (match) url = match.href;
      const cookieProps = {
        ...cookie,
        key: cookie.name,
        expires: cookie.expires !== '-1' ? new Date(parseInt(cookie.expires, 10)) : undefined,
      };
      if (!cookieProps.expires) delete cookieProps.expires;
      this.cookieJar.setCookieSync(new Cookie(cookieProps), url, {
        ignoreError: true,
      });
    }
    for (const origin of originUrls) {
      this.documentHasUserActivity(origin);
    }
  }

  private documentHasUserActivity(url: URL) {
    const hostname = canonicalDomain(url.hostname);
    if (!this.sitesWithUserInteraction.includes(hostname)) {
      this.sitesWithUserInteraction.push(hostname);
      let documentLoaded = this.userInteractionTrigger[hostname];
      if (!documentLoaded) {
        documentLoaded = createPromise();
        this.userInteractionTrigger[hostname] = documentLoaded;
      }

      (async () => {
        for (const { cookie, sourceUrl, sameSiteContext } of this.cookiesPendingSiteInteraction[
          hostname
        ] ?? []) {
          await this.cookieJar.setCookie(cookie, sourceUrl, {
            sameSiteContext,
          } as any);
        }
        delete this.cookiesPendingSiteInteraction[hostname];
      })()
        .then(documentLoaded.resolve)
        .catch(documentLoaded.reject);
    }
  }

  private async setCookie(cookiestring: string, resource: IHttpResourceLoadDetails) {
    const { url } = resource;
    const hostname = canonicalDomain(url.hostname);
    const cookie = Cookie.parse(cookiestring);
    const sameSiteContext = getSameSiteContext(resource);

    if (resource.hasUserGesture) {
      this.documentHasUserActivity(url);
    }
    if (!this.sitesWithUserInteraction.includes(hostname)) {
      if (!this.cookiesPendingSiteInteraction[hostname]) {
        this.cookiesPendingSiteInteraction[hostname] = [];
      }

      if (this.enableNov2019ITPSupport) {
        this.cookiesPendingSiteInteraction[hostname].push({
          sourceUrl: url.href,
          cookie,
          sameSiteContext,
        });
        return;
      }
    }
    await this.cookieJar.setCookie(cookie, url.href, {
      sameSiteContext,
    } as any);
  }

  private async getCookieHeader(resource: IHttpResourceLoadDetails) {
    const { url, documentUrl: sourceDocumentUrl } = resource;

    let sameSiteContext = getSameSiteContext(resource);
    if (resource.isFromRedirect) {
      const currentUrl = resource.url;
      const previousDomain = new URL(resource.firstRedirectingUrl);

      if (getPublicSuffix(previousDomain.hostname) === getPublicSuffix(currentUrl.hostname)) {
        sameSiteContext = 'strict';
      }
    }
    await this.waitForDocumentCookiesLoaded(sourceDocumentUrl);
    let cookies = await this.cookieJar.getCookies(url.href, {
      sameSiteContext,
    } as any);

    if (sameSiteContext === 'none') {
      cookies = cookies.filter(x => this.hasFirstPartyInteractionForDomain(x.domain));
    }

    cookies = this.handleNov2019ITPUpdates(sourceDocumentUrl, sameSiteContext, cookies);

    /** *
     * TBD:
     * >> Safari 13.1
     * (https://webkit.org/blog/9661/preventing-tracking-prevention-tracking/)
     * Cookies for cross-site resources are now blocked by default across the board. This is a
     * significant improvement for privacy since it removes any sense of exceptions or “a little bit
     * of cross-site tracking is allowed.”
     */
    if (this.enableFeb2020ITPSupport && this.isMinimumVersion(1) && sameSiteContext === 'none') {
      cookies = [];
    }

    return cookies.map(x => x.cookieString()).join('; ');
  }

  private async waitForDocumentCookiesLoaded(url: string) {
    const interactUrl = new URL(url);
    const hostname = canonicalDomain(interactUrl.hostname);
    if (!this.userInteractionTrigger[hostname]) {
      return;
    }
    await this.userInteractionTrigger[hostname];
  }

  private hasFirstPartyInteractionForDomain(domain: string) {
    for (const site of this.sitesWithUserInteraction) {
      const permutations = permuteDomain(site);
      for (const perm of permutations) {
        if (domainMatch(perm, domain)) return true;
      }
    }
    return false;
  }

  private handleNov2019ITPUpdates(
    sourceDocumentUrl: string,
    sameSiteContext: SameSiteContext,
    cookies: Cookie[],
  ) {
    if (!this.enableNov2019ITPSupport) {
      return cookies;
    }
    /**
     * https://webkit.org/blog/9521/intelligent-tracking-prevention-2-3/
     *
     * >> Safari 13.0.4 on macOS Catalina, Mojave, and High Sierra.
     * (https://webkit.org/blog/9661/preventing-tracking-prevention-tracking/)
     * ITP will now block all third-party requests from seeing their cookies, regardless of the
     * classification status of the third-party domain, unless the first-party website has already
     * received user interaction.
     *
     * Safari’s default cookie policy requires a third-party to have “seeded” its cookie jar as first-party
     * before it can use cookies as third-party. This means the absence of cookies in a third-party request
     * can be due to ITP blocking existing cookies or the default cookie policy blocking cookies because the
     * user never visited the website, the website’s cookies have expired, or because the user or
     * ITP has explicitly deleted the website’s cookies.
     */
    if (this.isMinimumVersion(0, 4) && sameSiteContext !== 'strict') {
      const domain = canonicalDomain(sourceDocumentUrl);
      if (!this.sitesWithUserInteraction.some(y => domainMatch(y, domain))) {
        return [];
      }
    }
    return cookies;
  }

  private isMinimumVersion(minor: number, patch = 0) {
    return this.userAgent.version.minor >= minor && this.userAgent.version.patch >= patch;
  }
}

function getSameSiteContext(resource: IHttpResourceLoadDetails): SameSiteContext {
  const { hasUserGesture, originType } = resource;
  if (originType === 'same-site' || originType === 'same-origin' || originType === 'none') {
    return 'strict';
  }
  if (hasUserGesture) {
    return 'lax';
  }
  return 'none';
}
