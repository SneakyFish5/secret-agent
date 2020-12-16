import { Helpers } from '@secret-agent/testing';
import { InteractionCommand } from '@secret-agent/core-interfaces/IInteractions';
import { ITestKoaServer } from '@secret-agent/testing/helpers';
import Core from '../index';
import CoreServerConnection from '../lib/CoreServerConnection';
import Session from '../lib/Session';

let koaServer: ITestKoaServer;
let connection: CoreServerConnection;
beforeAll(async () => {
  connection = Core.addConnection();
  await connection.connect();
  Helpers.onClose(() => connection.disconnect(), true);
  koaServer = await Helpers.runKoaServer();
});
afterAll(Helpers.afterAll);
afterEach(Helpers.afterEach);

describe('basic Tab tests', () => {
  it('waits for an element', async () => {
    koaServer.get('/test1', ctx => {
      ctx.body = `<body>
<script>
    setTimeout(function() {
      const elem = document.createElement('A');
      elem.setAttribute('href', '/test2');
      document.body.append(elem)
    }, 500);
</script>
</body>`;
    });

    const meta = await connection.createSession();
    const tab = Session.getTab(meta);
    Helpers.needsClosing.push(tab.session);
    await tab.goto(`${koaServer.baseUrl}/test1`);

    await expect(tab.waitForElement(['document', ['querySelector', 'a']])).resolves.toBe(true);
  });

  it('times out waiting for an element', async () => {
    koaServer.get('/test2', ctx => {
      ctx.body = `<body><a>Nothing really here</a></body>`;
    });
    const meta = await connection.createSession();
    const tab = Session.getTab(meta);
    Helpers.needsClosing.push(tab.session);
    await tab.goto(`${koaServer.baseUrl}/test2`);

    await expect(
      tab.waitForElement(['document', ['querySelector', 'a#notthere']], { timeoutMs: 500 }),
    ).rejects.toThrowError(/Timeout waiting for element .* to be visible/);
  });

  it('will wait for an element to be visible', async () => {
    koaServer.get('/test3', ctx => {
      ctx.body = `<body>
    <a id="waitToShow" href="/anywhere" style="display: none">Link</a>
<script>
    setTimeout(function() {
      document.querySelector('a#waitToShow').style.display = 'block';
    }, 150);
</script>
</body>`;
    });
    const meta = await connection.createSession();
    const tab = Session.getTab(meta);
    Helpers.needsClosing.push(tab.session);
    await tab.goto(`${koaServer.baseUrl}/test3`);

    await expect(
      tab.waitForElement(['document', ['querySelector', 'a#waitToShow']], {
        waitForVisible: true,
      }),
    ).resolves.toBe(true);
  });

  it('can wait for another tab', async () => {
    let useragent1: string;
    let useragent2: string;
    koaServer.get('/tabTest', ctx => {
      useragent1 = ctx.get('user-agent');
      ctx.body = `<body>
<a target="_blank" href="/tabTestDest">Nothing really here</a>
</body>`;
    });
    koaServer.get('/tabTestDest', ctx => {
      useragent2 = ctx.get('user-agent');
      ctx.body = `<body><h1 id="newTabHeader">You are here</h1></body>`;
    });
    const meta = await connection.createSession();
    const tab = Session.getTab(meta);
    Helpers.needsClosing.push(tab.session);
    await tab.goto(`${koaServer.baseUrl}/tabTest`);
    await tab.interact([
      {
        command: InteractionCommand.click,
        mousePosition: ['window', 'document', ['querySelector', 'a']],
      },
    ]);

    const session = tab.session;

    const newTab = await tab.waitForNewTab();
    expect(session.tabs).toHaveLength(2);
    await newTab.waitForLoad('AllContentLoaded');
    const header = await newTab.execJsPath([
      'document',
      ['querySelector', '#newTabHeader'],
      'textContent',
    ]);
    expect(header.value).toBe('You are here');
    expect(useragent1).toBe(useragent2);
    await newTab.close();
  });
});
