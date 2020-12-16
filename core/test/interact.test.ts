import { Helpers } from '@secret-agent/testing';
import { InteractionCommand } from '@secret-agent/core-interfaces/IInteractions';
import HumanEmulatorGhost from '@secret-agent/emulate-humans-ghost';
import { ITestKoaServer } from '@secret-agent/testing/helpers';
import Core, { Session } from '../index';
import CoreServerConnection from '../lib/CoreServerConnection';

let koaServer: ITestKoaServer;
let connection: CoreServerConnection;
beforeAll(async () => {
  connection = Core.addConnection();
  await connection.connect();
  Helpers.onClose(() => connection.disconnect(), true);

  HumanEmulatorGhost.maxDelayBetweenInteractions = 0;
  HumanEmulatorGhost.maxScrollDelayMillis = 0;
  koaServer = await Helpers.runKoaServer();
});
afterAll(Helpers.afterAll, 30e3);
afterEach(Helpers.afterEach);

describe.each([['ghost'], ['basic'], ['skipper']])(
  '%s interaction tests',
  (humanEmulatorId: string) => {
    it('executes basic click command', async () => {
      koaServer.get('/mouse', ctx => {
        ctx.body = `
        <body>
          <button>Test</button>
          <script>
            document.querySelector('button').addEventListener('click', event => {
              document.querySelector('button').classList.add('clicked');
            });
          </script>
        </body>
      `;
      });
      const meta = await connection.createSession({ humanEmulatorId });
      const session = Session.get(meta.sessionId);
      Helpers.needsClosing.push(session);
      const tab = Session.getTab(meta);
      await tab.goto(`${koaServer.baseUrl}/mouse`);

      const spy = jest.spyOn(session.humanEmulator, 'playInteractions');
      await tab.interact([
        {
          command: InteractionCommand.click,
          mousePosition: ['window', 'document', ['querySelector', 'button']],
        },
      ]);

      expect(spy).toHaveBeenCalledTimes(1);
      const interactGroups = spy.mock.calls[0][0];
      expect(interactGroups).toHaveLength(1);
      expect(interactGroups[0]).toHaveLength(2);
      expect(interactGroups[0][0].command).toBe('scroll');

      const buttonClass = await tab.execJsPath([
        'document',
        ['querySelector', 'button.clicked'],
        'classList',
      ]);
      expect(buttonClass.value).toStrictEqual({ 0: 'clicked' });
    });

    it('executes basic type command', async () => {
      koaServer.get('/input', ctx => {
        ctx.set('Content-Security-Policy', "script-src 'unsafe-eval'");
        ctx.body = `
        <body>
          <input type="text" />
        </body>
      `;
      });
      const meta = await connection.createSession({ humanEmulatorId });
      const session = Session.get(meta.sessionId);
      Helpers.needsClosing.push(session);
      const tab = Session.getTab(meta);

      await tab.goto(`${koaServer.baseUrl}/input`);
      await tab.execJsPath(['document', ['querySelector', 'input'], ['focus']]);
      await tab.interact([
        {
          command: InteractionCommand.type,
          keyboardCommands: [{ string: 'Hello world!' }],
        },
      ]);
      const inputValue = await tab.execJsPath(['document', ['querySelector', 'input'], 'value']);
      expect(inputValue.value).toBe('Hello world!');
    });

    it('should be able to click elements off screen', async () => {
      koaServer.get('/longpage', ctx => {
        ctx.body = `
        <body>
          <div style="height:500px">
            <button id="button-1" onclick="click1(event)">Test</button>
          </div>
          <div style="margin-top:1100px; flex: content; justify-content: center">
            <button id="button-2" onclick="click2()" style="width: 30px; height: 20px;">Test 2</button>
          </div>
          <div style="margin-top:2161px; float:right;clear:both: width:20px; height: 20px;">
            <button id="button-3" onclick="click3()">Test 3</button>
          </div>
          <script>
            let lastClicked = '';
            function click1(ev) {
              lastClicked = 'click1' + (ev.isTrusted ? '' : '!!untrusted');
            }
            function click2() {
              lastClicked = 'click2';
            }
            function click3() {
              lastClicked = 'click3';
            }
          </script>
        </body>
      `;
      });

      const meta = await connection.createSession({
        humanEmulatorId,
        viewport: {
          width: 1920,
          height: 1080,
          screenWidth: 1920,
          screenHeight: 1080,
          positionX: 0,
          positionY: 0,
        },
      });
      const session = Session.get(meta.sessionId);
      Helpers.needsClosing.push(session);
      const tab = Session.getTab(meta);
      await tab.goto(`${koaServer.baseUrl}/longpage`);

      const click = async (selector: string) => {
        await tab.interact([
          {
            command: InteractionCommand.click,
            mousePosition: ['window', 'document', ['querySelector', selector]],
          },
        ]);
        return await tab.getJsValue('lastClicked');
      };

      let lastClicked = await click('#button-1');
      expect(lastClicked.value).toBe('click1');

      lastClicked = await click('#button-2');
      expect(lastClicked.value).toBe('click2');

      lastClicked = await click('#button-3');
      expect(lastClicked.value).toBe('click3');

      lastClicked = await click('#button-1');
      expect(lastClicked.value).toBe('click1');
    }, 60e3);
  },
);
