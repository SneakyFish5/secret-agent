# Configuration

Configuration variables can be defined at a few levels:

- `Agent` At an Agent instance level, configured on the default instance via [agent.configure()](../basic-interfaces/agent#configure), or when creating [Handler](../basic-interfaces/handler) agents using [handler.createAgent()](../basic-interfaces/handler#create-agent) or [handler.dispatchAgent()](../basic-interfaces/handler#dispatch-agent).
- `Connection` At a "Connection to Core" level, which can be configured when creating a new [connection](../basic-interfaces/Handler#connection) to a full SecretAgent runtime (called Core) in the [new Handler(...connections)](../basic-interfaces/handler) constructor.
- `Core` At an internal level, using the `@secret-agent/core` module of SecretAgent. This must be run in the environment where your Browser Engine(s) and `@secret-agent/core` module are running. If you're running remote, this will be your server.

The internal `@secret-agent/core` module can receive several configuration options on [start](#core-start), or when a [Handler](../basic-interfaces/handler) establishes a connection.

### Max Concurrent Agents Count <div class="specs"><i>Core</i></div>

Limit concurrent Agents operating at any given time across all [connections](../basic-interfaces/handler#connection) to a "Core". Defaults to `10`.

Configurable via [`Core.start()`](#core-start) or [`new Handler()`](../basic-interfaces/handler#constructor).

### Local Proxy Port Start <div class="specs"><i>Connection</i><i>Core</i></div>

Configures the port the Man-In-the-Middle server will listen on locally. This server will correct headers and TLS signatures sent by requests to properly emulate the desired browser engine. Default port is `0`, which will find an open port locally.

Configurable via `Core.start()` or [`new Handler()`](../basic-interfaces/handler#constructor)

### Replay Session Port <div class="specs"><i>Connection</i><i>Core</i></div>

Configures the port Replay uses to serve Session data.

Configurable via [`Core.start()`](#core-start) or [`new Handler()`](../basic-interfaces/handler#constructor)

### Sessions Dir <div class="specs"><i>Connection</i><i>Core</i></div>

Configures the storage location for files created by Core.

- Replay session files
- Man-in-the-middle network certificates

`Environmental variable`: `SA_SESSIONS_DIR=/your-absolute-dir-path`

Configurable via [`Core.start()`](#core-start) or [`new Handler()`](../basic-interfaces/handler#constructor).

### Rendering Options <div class="specs"><i>Connection</i><i>Agent</i></div> {#rendering}

One of the best ways to optimize SecretAgent's memory and CPU is limiting the `renderingOptions` to only what you need. The following are valid options.

<p class="show-table-header show-bottom-border minimal-row-height"></p>

| Options         | Description                                                    |
| --------------- | -------------------------------------------------------------- |
| `AwaitedDOM`    | Uses Chromium to attach AwaitedDOM to window.document.         |
| `JsRuntime`     | Executes JS in webpage. Requires `AwaitedDOM`.                 |
| `LoadJsAssets`  | Loads all referenced script assets. Requires `JsRuntime`.      |
| `LoadCssAssets` | Loads all referenced CSS assets. Requires `JsRuntime`.         |
| `LoadImages`    | Loads all referenced images on page. Requires `JsRuntime`.     |
| `LoadAssets`    | Shortcut for `LoadJsAssets`, `LoadCssAssets` and `LoadImages`. |
| `All`           | Activates all features listed above.                           |
| `None`          | No AwaitedDOM or assets. Only retrieves window.response.       |

As you'll notice above, some features are dependent on others and therefore automatically enable other features.

Setting an empty features array is the same as setting its default.

### User Profile <div class="specs"><i>Connection</i><i>Agent</i></div>

A user profile stores and restores Cookies, DOM Storage and IndexedDB records for an Agent. NOTE: the serialized user profile passed into an Agent instance is never modified. If you want to update a profile with changes, you should re-export and save it to the format you're persisting to.

```js
const rawProfileJson = fs.readFileSync('profile.json', 'utf-8');
const profile = JSON.parse(rawProfileJson); // { cookies: { sessionId: 'test' }}

agent.configure({ userProfile: profile });
const latestUserProfile = await agent.exportUserProfile();
// { cookies, localStorage, sessionStorage, indexedDBs }

await agent.goto('http://example.com');

const latestUserProfile = await agent.exportUserProfile();

fs.writeFileSync('profile.json', JSON.stringify(latestUserProfile, null, 2));
```

### Upstream Proxy <div class="specs"><i>Agent</i></div>

Configures a proxy url to route traffic through for a given Agent. This function supports two types of proxies:

- `Socks5` - many VPN providers allow you to use a socks5 configuration to send traffic through one of their VPNs behind the scenes. You can pass any required username and password through the `UserInfo` portion of the url, e.g., `socks5://username:password@sockshost.com:1080`.
- `Http` - an http proxy will create secure TLS socket to an upstream server using the HTTP connect verb. Services like [luminati](https://luminati.io) provide highly configurable Http proxies that can route traffic from various geographic locations and "grade" of IP - ie, consumer IP vs datacenter.

An upstream proxy url should be a fully formatted url to the proxy. If your proxy is socks5, start it with `socks5://`, http `http://` or `https://` as needed. An upstream proxy url can optionally include the user authentication parameters in the url. It will be parsed out and used as the authentication.

### Browsers Emulator Ids <div class="specs"><i>Connection</i><i>Agent</i><i>Core</i></div>

Configures which [BrowserEmulators](../advanced/browser-emulators) to enable or use in a given Agent.

At an Agent level, `browserEmulatorId` configures the module to use.

- Configurable via [`Handler.createAgent()`](../basic-interfaces/handler#create-agent) or [`Handler.dispatchAgent()`](../basic-interfaces/handler#dispatch-agent).

At a Connection or Core level, `browserEmulatorIds` indicates a list of modules to initialize before any Agents are created.

- Configurable via [`Core.start()`](#core-start) or [`new Handler(...connections)`](../basic-interfaces/handler).

### HumanEmulators <div class="specs"><i>Connection</i><i>Agent</i></div>

Configures which [HumanEmulators](../advanced/human-emulators) to use in an Agent instance.

At an Agent level, `browserEmulatorId` configures the module to use.

- Configurable via [`Handler.createAgent()`](../basic-interfaces/handler#create-agent) or [`Handler.dispatchAgent()`](../basic-interfaces/handler#dispatch-agent).

At a Connection or Core level, `browserEmulatorIds` indicates a list of modules to initialize before any Agents are created.

- Configurable via [`Core.start()`](#core-start) or [`new Handler(...connections)`](../basic-interfaces/handler).

## Core Configuration

Configuration for Core should be performed before initialization.

### Core.start*(options)* {#core-start}

Update existing settings.

#### **Arguments**:

- options `object` Accepts any of the following:
  - maxConcurrentAgentsCount `number` defaults to `10`. Limit concurrent Agent sessions running at any given time.
  - localProxyPortStart `number` defaults to `any open port`. Starting internal port to use for the mitm proxy.
  - sessionsDir `string` defaults to `os.tmpdir()/.secret-agent`. Directory to store session files and mitm certificates.
  - defaultRenderingOptions `string[]` defaults to `[All]`. Controls enabled browser rendering features.
  - defaultUserProfile `IUserProfile`. Define user cookies, session, and more.
  - replayServerPort `number`. Port to start a live replay server on. Defaults to "any open port".

#### **Returns**: `Promise`
