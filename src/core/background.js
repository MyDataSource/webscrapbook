/******************************************************************************
 *
 * The background script for the main (auto-generated) background page.
 *
 *****************************************************************************/

(function (root, factory) {
  // Browser globals
  root.background = factory(
    root.isDebug,
    root.browser,
    root.scrapbook,
    window,
    console,
  );
}(this, function (isDebug, browser, scrapbook, window, console) {

  'use strict';

  const background = {
    commands: {
      async openScrapBook() {
        return await scrapbook.openScrapBook({});
      },

      async openOptions() {
        return await scrapbook.visitLink({
          url: browser.runtime.getURL("core/options.html"),
          newTab: true,
          singleton: true,
        });
      },

      async openViewer() {
        return await scrapbook.visitLink({
          url: browser.runtime.getURL("viewer/load.html"),
          newTab: true,
        });
      },

      async captureTab() {
        return await scrapbook.invokeCapture(
          (await scrapbook.getHighlightedTabs()).map(tab => ({
            tabId: tab.id,
          }))
        );
      },

      async captureTabSource() {
        return await scrapbook.invokeCapture(
          (await scrapbook.getHighlightedTabs()).map(tab => ({
            tabId: tab.id,
            mode: "source",
          }))
        );
      },

      async captureTabBookmark() {
        return await scrapbook.invokeCapture(
          (await scrapbook.getHighlightedTabs()).map(tab => ({
            tabId: tab.id,
            mode: "bookmark",
          }))
        );
      },

      async editTab() {
        const tab = (await browser.tabs.query({active: true, currentWindow: true}))[0];
        return await scrapbook.editTab({
          tabId: tab.id,
          force: true,
        });
      },
    },
  };

  /* browser action button and fallback */
  if (!browser.browserAction) {
    // Firefox Android < 55: no browserAction
    // Fallback to pageAction.
    // Firefox Android ignores the tabId parameter and
    // shows the pageAction for all tabs
    browser.pageAction.show(0);
  } else if (!browser.browserAction.getPopup) {
    // Firefox Android >= 55: only browserAction onClick
    // Open the browserAction page
    browser.browserAction.onClicked.addListener((tab) => {
      const url = browser.runtime.getURL("core/browserAction.html");
      browser.tabs.create({url, active: true});
    });
  }

  /**
   * @kind invokable
   */
  background.invokeFrameScript = async function ({frameId, cmd, args}, sender) {
    const tabId = sender.tab.id;
    return await scrapbook.invokeContentScript({
      tabId, frameId, cmd, args,
    });
  };

  /**
   * Attempt to locate an item in the sidebar.
   *
   * @kind invokable
   * @return {Object|null|false} - The located item.
   *     - Object: the located item
   *     - null: no item located
   *     - false: no sidebar opened
   */
  background.locateItem = async function (params, sender) {
    const cmd = 'tree.locate';
    const args = params;
    const sidebarUrl = browser.runtime.getURL("scrapbook/sidebar.html");

    if (browser.sidebarAction) {
      // Unfortunately we cannot force open the sidebar from a user gesture
      // in a content page if it's closed.
      if (!await browser.sidebarAction.isOpen({})) {
        return false;
      }

      // pass windowId to restrict response to the current window sidebar
      return await scrapbook.invokeExtensionScript({id: (await browser.windows.getCurrent()).id, cmd, args});
    } else if (browser.windows) {
      const sidebarWindow = (await browser.windows.getAll({
        windowTypes: ['popup'],
        populate: true,
      })).filter(w => scrapbook.splitUrl(w.tabs[0].url)[0] === sidebarUrl)[0];

      if (!sidebarWindow) {
        return false;
      }

      const tabId = sidebarWindow.tabs[0].id;
      const result = await scrapbook.invokeContentScript({tabId, frameId: 0, cmd, args});

      if (result) {
        await browser.windows.update(sidebarWindow.id, {drawAttention: true});
      }

      return result;
    } else {
      // Firefox Android does not support windows
      const sidebarTab = (await browser.tabs.query({}))
          .filter(t => scrapbook.splitUrl(t.url)[0] === sidebarUrl)[0];

      if (!sidebarTab) {
        return false;
      }

      const tabId = sidebarTab.id;
      const result = await scrapbook.invokeContentScript({tabId, frameId: 0, cmd, args});

      if (result) {
        await browser.tabs.update(tabId, {active: true});
      }

      return result;
    }
  };

  /**
   * @kind invokable
   */
  background.saveCurrentTab = async function (params, sender) {
    return await scrapbook.invokeCapture([{
      tabId: sender.tab.id,
      mode: 'save',
    }]);
  };

  /**
   * @kind invokable
   */
  background.captureCurrentTab = async function (params, sender) {
    return await scrapbook.invokeCapture([{
      tabId: sender.tab.id,
    }]);
  };

  /**
   * @kind invokable
   */
  background.invokeEditorCommand = async function ({code, cmd, args, frameId = -1, frameIdExcept = -1}, sender) {
    const tabId = sender.tab.id;
    if (frameId !== -1) {
      const response = code ? 
        await browser.tabs.executeScript(tabId, {
          frameId,
          code,
          runAt: "document_start",
        }) : 
        await scrapbook.invokeContentScript({
          tabId, frameId, cmd, args,
        });
      await browser.tabs.executeScript(tabId, {
        frameId,
        code: `window.focus();`,
        runAt: "document_start"
      });
      return response;
    } else if (frameIdExcept !== -1) {
      const tasks = Array.prototype.map.call(
        await scrapbook.initContentScripts(tabId),
        async ({tabId, frameId, injected}) => {
          if (frameId === frameIdExcept) { return undefined; }
          return code ? 
            await browser.tabs.executeScript(tabId, {
              frameId,
              code,
              runAt: "document_start",
            }) : 
            await scrapbook.invokeContentScript({
              tabId, frameId, cmd, args,
            });
        });
      return Promise.all(tasks);
    } else {
      const tasks = Array.prototype.map.call(
        await scrapbook.initContentScripts(tabId),
        async ({tabId, frameId, injected}) => {
          return code ? 
            await browser.tabs.executeScript(tabId, {
              frameId,
              code,
              runAt: "document_start",
            }) : 
            await scrapbook.invokeContentScript({
              tabId, frameId, cmd, args,
            });
        });
      return Promise.all(tasks);
    }
  };

  /* commands */
  if (browser.commands) {
    browser.commands.onCommand.addListener((cmd) => {
      return background.commands[cmd]();
    });
  }

  {
    const extraInfoSpec = ["blocking", "requestHeaders"];
    if (browser.webRequest.OnBeforeSendHeadersOptions.hasOwnProperty('EXTRA_HEADERS')) {
      extraInfoSpec.push('extraHeaders');
    }
    browser.webRequest.onBeforeSendHeaders.addListener((details) => {
      // Some headers (e.g. "referer") are not allowed to be set via
      // XMLHttpRequest.setRequestHeader directly.  Use a prefix and
      // modify it here to workaround.
      details.requestHeaders.forEach((header) => {
        if (header.name.slice(0, 15) === "X-WebScrapBook-") {
          header.name = header.name.slice(15);
        }
      });
      return {requestHeaders: details.requestHeaders};
    }, {urls: ["<all_urls>"], types: ["xmlhttprequest"]}, extraInfoSpec);
  }

  scrapbook.addMessageListener((message, sender) => {
    if (!message.cmd.startsWith("background.")) { return false; }
    return true;
  });

  if (browser.runtime.onMessageExternal) {
    // Available for Firefox >= 54.
    browser.runtime.onMessageExternal.addListener((message, sender) => {
      const {cmd, args} = message;

      let result;
      switch (cmd) {
        case "invokeCapture": {
          result = scrapbook.invokeCapture(args);
          break;
        }
        case "invokeCaptureEx": {
          result = scrapbook.invokeCaptureEx(args);
          break;
        }
        default: {
          // thrown Error don't show here but cause the sender to receive an error
          throw new Error(`Unable to invoke unknown command '${cmd}'.`);
        }
      }

      return Promise.resolve(result)
        .catch((ex) => {
          console.error(ex);
          return {error: {message: ex.message}};
        });
    });
  }


  return background;

}));
