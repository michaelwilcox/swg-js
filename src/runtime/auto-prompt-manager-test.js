/**
 * Copyright 2021 The Subscribe with Google Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {AnalyticsEvent, EventOriginator} from '../proto/api_messages';
import {AutoPromptConfig, UiPredicates} from '../model/auto-prompt-config';
import {AutoPromptManager} from './auto-prompt-manager';
import {AutoPromptType} from '../api/basic-subscriptions';
import {ClientConfig} from '../model/client-config';
import {ClientConfigManager} from './client-config-manager';
import {ClientEventManager} from './client-event-manager';
import {DepsDef} from './deps';
import {Entitlements} from '../api/entitlements';
import {EntitlementsManager} from './entitlements-manager';
import {Fetcher} from './fetcher';
import {MiniPromptApi} from './mini-prompt-api';
import {PageConfig} from '../model/page-config';
import {Storage} from './storage';
import {tick} from '../../test/tick';

const STORAGE_KEY_IMPRESSIONS = 'autopromptimp';
const STORAGE_KEY_DISMISSALS = 'autopromptdismiss';
const CURRENT_TIME = 1615416442; // GMT: Wednesday, March 10, 2021 10:47:22 PM

describes.realWin('AutoPromptManager', {}, (env) => {
  let autoPromptManager;
  let win;
  let deps;
  let pageConfig;
  let fetcher;
  let eventManager;
  let eventManagerCallback;
  let entitlementsManager;
  let entitlementsManagerMock;
  let clientConfigManager;
  let clientConfigManagerMock;
  let storageMock;
  let alternatePromptSpy;
  let miniPromptApiMock;
  const productId = 'pub1:label1';
  const pubId = 'pub1';

  beforeEach(() => {
    deps = new DepsDef();

    sandbox.useFakeTimers(CURRENT_TIME);
    win = env.win;
    win.setTimeout = (callback) => callback();
    sandbox.stub(deps, 'win').returns(win);

    pageConfig = new PageConfig(productId);
    sandbox.stub(deps, 'pageConfig').returns(pageConfig);

    eventManager = new ClientEventManager(Promise.resolve());
    sandbox.stub(deps, 'eventManager').returns(eventManager);
    sandbox
      .stub(eventManager, 'registerEventListener')
      .callsFake((callback) => (eventManagerCallback = callback));

    const storage = new Storage(win);
    storageMock = sandbox.mock(storage);
    sandbox.stub(deps, 'storage').returns(storage);

    fetcher = new Fetcher(win);
    entitlementsManager = new EntitlementsManager(
      win,
      pageConfig,
      fetcher,
      deps
    );
    entitlementsManagerMock = sandbox.mock(entitlementsManager);
    sandbox.stub(deps, 'entitlementsManager').returns(entitlementsManager);

    clientConfigManager = new ClientConfigManager(pubId, fetcher);
    clientConfigManagerMock = sandbox.mock(clientConfigManager);
    sandbox.stub(deps, 'clientConfigManager').returns(clientConfigManager);

    sandbox.stub(MiniPromptApi.prototype, 'init');
    autoPromptManager = new AutoPromptManager(deps);
    autoPromptManager.autoPromptDisplayed_ = true;

    miniPromptApiMock = sandbox.mock(autoPromptManager.miniPromptAPI_);
    alternatePromptSpy = sandbox.spy();
  });

  afterEach(() => {
    entitlementsManagerMock.verify();
    clientConfigManagerMock.verify();
    storageMock.verify();
    miniPromptApiMock.verify();
  });

  it('should be listening for events from the events manager', () => {
    expect(eventManagerCallback).to.not.be.null;
  });

  it('should locally store contribution impressions when contribution impression events are fired', async () => {
    storageMock
      .expects('get')
      .withExactArgs(STORAGE_KEY_IMPRESSIONS, /* useLocalStorage */ true)
      .returns(Promise.resolve(null))
      .once();
    storageMock
      .expects('set')
      .withExactArgs(
        STORAGE_KEY_IMPRESSIONS,
        CURRENT_TIME.toString(),
        /* useLocalStorage */ true
      )
      .returns(Promise.resolve())
      .once();

    await eventManagerCallback({
      eventType: AnalyticsEvent.IMPRESSION_SWG_CONTRIBUTION_MINI_PROMPT,
      eventOriginator: EventOriginator.UNKNOWN_CLIENT,
      isFromUserAction: null,
      additionalParameters: null,
    });
  });

  it('should locally store subscription impressions when subscription impression events are fired', async () => {
    storageMock
      .expects('get')
      .withExactArgs(STORAGE_KEY_IMPRESSIONS, /* useLocalStorage */ true)
      .returns(Promise.resolve(null))
      .once();
    storageMock
      .expects('set')
      .withExactArgs(
        STORAGE_KEY_IMPRESSIONS,
        CURRENT_TIME.toString(),
        /* useLocalStorage */ true
      )
      .returns(Promise.resolve())
      .once();

    await eventManagerCallback({
      eventType: AnalyticsEvent.IMPRESSION_SWG_SUBSCRIPTION_MINI_PROMPT,
      eventOriginator: EventOriginator.UNKNOWN_CLIENT,
      isFromUserAction: null,
      additionalParameters: null,
    });
  });

  it('should locally store contribution dismissals when contribution dismissal events are fired', async () => {
    storageMock
      .expects('get')
      .withExactArgs(STORAGE_KEY_DISMISSALS, /* useLocalStorage */ true)
      .returns(Promise.resolve(null))
      .once();
    storageMock
      .expects('set')
      .withExactArgs(
        STORAGE_KEY_DISMISSALS,
        CURRENT_TIME.toString(),
        /* useLocalStorage */ true
      )
      .returns(Promise.resolve())
      .once();

    await eventManagerCallback({
      eventType: AnalyticsEvent.ACTION_SWG_CONTRIBUTION_MINI_PROMPT_CLOSE,
      eventOriginator: EventOriginator.UNKNOWN_CLIENT,
      isFromUserAction: null,
      additionalParameters: null,
    });
  });

  it('should locally store subscription dismissals when subscription dismissal events are fired', async () => {
    storageMock
      .expects('get')
      .withExactArgs(STORAGE_KEY_DISMISSALS, /* useLocalStorage */ true)
      .returns(Promise.resolve(null))
      .once();
    storageMock
      .expects('set')
      .withExactArgs(
        STORAGE_KEY_DISMISSALS,
        CURRENT_TIME.toString(),
        /* useLocalStorage */ true
      )
      .returns(Promise.resolve())
      .once();

    await eventManagerCallback({
      eventType: AnalyticsEvent.ACTION_SWG_SUBSCRIPTION_MINI_PROMPT_CLOSE,
      eventOriginator: EventOriginator.UNKNOWN_CLIENT,
      isFromUserAction: null,
      additionalParameters: null,
    });
  });

  it('should not store events when an impression or dismissal was fired for a paygated article', async () => {
    sandbox.stub(pageConfig, 'isLocked').returns(true);
    storageMock.expects('get').never();
    storageMock.expects('set').never();

    await eventManagerCallback({
      eventType: AnalyticsEvent.IMPRESSION_OFFERS,
      eventOriginator: EventOriginator.UNKNOWN_CLIENT,
      isFromUserAction: null,
      additionalParameters: null,
    });

    await eventManagerCallback({
      eventType: AnalyticsEvent.ACTION_SUBSCRIPTION_OFFERS_CLOSED,
      eventOriginator: EventOriginator.UNKNOWN_CLIENT,
      isFromUserAction: null,
      additionalParameters: null,
    });
  });

  it('should ignore irrelevant events', async () => {
    storageMock.expects('get').never();
    storageMock.expects('set').never();

    await eventManagerCallback({
      eventType: AnalyticsEvent.IMPRESSION_AD,
      eventOriginator: EventOriginator.UNKNOWN_CLIENT,
      isFromUserAction: null,
      additionalParameters: null,
    });
  });

  it('should display the contribution mini prompt if the user has no entitlements', async () => {
    const entitlements = new Entitlements();
    entitlementsManagerMock
      .expects('getEntitlements')
      .returns(Promise.resolve(entitlements))
      .once();
    const clientConfig = new ClientConfig();
    clientConfigManagerMock
      .expects('getClientConfig')
      .returns(Promise.resolve(clientConfig))
      .once();
    // alwaysShow is false
    miniPromptApiMock.expects('create').never();

    await autoPromptManager.showAutoPrompt({
      autoPromptType: AutoPromptType.CONTRIBUTION,
      alwaysShow: false,
      displayLargePromptFn: alternatePromptSpy,
    });
    expect(alternatePromptSpy).to.not.be.called;
  });

  it('should display the mini prompt, but not fetch entitlements and client config if alwaysShow is enabled', async () => {
    entitlementsManagerMock.expects('getEntitlements').never();
    clientConfigManagerMock.expects('getAutoPromptConfig').never();
    miniPromptApiMock.expects('create').once();

    await autoPromptManager.showAutoPrompt({
      autoPromptType: AutoPromptType.CONTRIBUTION,
      alwaysShow: true,
      displayLargePromptFn: alternatePromptSpy,
    });
    expect(alternatePromptSpy).to.not.be.called;
  });

  it('should display the large prompt, but not fetch entitlements and client config if alwaysShow is enabled', async () => {
    entitlementsManagerMock.expects('getEntitlements').never();
    clientConfigManagerMock.expects('getAutoPromptConfig').never();
    miniPromptApiMock.expects('create').never();

    await autoPromptManager.showAutoPrompt({
      autoPromptType: AutoPromptType.CONTRIBUTION_LARGE,
      alwaysShow: true,
      displayLargePromptFn: alternatePromptSpy,
    });
    expect(alternatePromptSpy).to.be.calledOnce;
  });

  it('should not display any prompt if the type is undefined', async () => {
    const entitlements = new Entitlements();
    entitlementsManagerMock
      .expects('getEntitlements')
      .returns(Promise.resolve(entitlements))
      .once();
    const clientConfig = new ClientConfig();
    clientConfigManagerMock
      .expects('getClientConfig')
      .returns(Promise.resolve(clientConfig))
      .once();
    miniPromptApiMock.expects('create').never();

    await autoPromptManager.showAutoPrompt({
      autoPromptType: undefined,
      alwaysShow: false,
      displayLargePromptFn: alternatePromptSpy,
    });
    expect(alternatePromptSpy).to.not.be.called;
  });

  it('should not display any prompt if the type is NONE', async () => {
    const entitlements = new Entitlements();
    entitlementsManagerMock
      .expects('getEntitlements')
      .returns(Promise.resolve(entitlements))
      .once();
    const clientConfig = new ClientConfig();
    clientConfigManagerMock
      .expects('getClientConfig')
      .returns(Promise.resolve(clientConfig))
      .once();
    miniPromptApiMock.expects('create').never();

    await autoPromptManager.showAutoPrompt({
      autoPromptType: AutoPromptType.NONE,
      alwaysShow: false,
      displayLargePromptFn: alternatePromptSpy,
    });
    expect(alternatePromptSpy).to.not.be.called;
  });

  it('should not display any prompt if the auto prompt config is not returned', async () => {
    const entitlements = new Entitlements();
    entitlementsManagerMock
      .expects('getEntitlements')
      .returns(Promise.resolve(entitlements))
      .once();
    const clientConfig = new ClientConfig();
    clientConfigManagerMock
      .expects('getClientConfig')
      .returns(clientConfig)
      .once();
    miniPromptApiMock.expects('create').never();

    await autoPromptManager.showAutoPrompt({
      autoPromptType: AutoPromptType.CONTRIBUTION,
      alwaysShow: false,
      displayLargePromptFn: alternatePromptSpy,
    });
    expect(alternatePromptSpy).to.not.be.called;
  });

  it('should display the mini prompt if the auto prompt config does not cap impressions', async () => {
    const entitlements = new Entitlements();
    entitlementsManagerMock
      .expects('getEntitlements')
      .returns(Promise.resolve(entitlements))
      .once();
    const clientConfig = new ClientConfig();
    clientConfigManagerMock
      .expects('getClientConfig')
      .returns(Promise.resolve(clientConfig))
      .once();
    // alwaysShow is false
    miniPromptApiMock.expects('create').never();

    await autoPromptManager.showAutoPrompt({
      autoPromptType: AutoPromptType.CONTRIBUTION,
      alwaysShow: false,
      displayLargePromptFn: alternatePromptSpy,
    });
    expect(alternatePromptSpy).to.not.be.called;
  });

  it('should not display the mini prompt if the auto prompt config caps impressions, and the user is over the cap', async () => {
    const entitlements = new Entitlements();
    entitlementsManagerMock
      .expects('getEntitlements')
      .returns(Promise.resolve(entitlements))
      .once();
    const autoPromptConfig = new AutoPromptConfig(/* maxImpressionsPerWeek*/ 2);
    const clientConfig = new ClientConfig({autoPromptConfig});
    clientConfigManagerMock
      .expects('getClientConfig')
      .returns(Promise.resolve(clientConfig))
      .once();
    // Two stored impressions.
    const storedImpressions =
      (CURRENT_TIME + 1).toString() + ',' + CURRENT_TIME.toString();
    storageMock
      .expects('get')
      .withExactArgs(STORAGE_KEY_IMPRESSIONS, /* useLocalStorage */ true)
      .returns(Promise.resolve(storedImpressions))
      .once();
    storageMock
      .expects('get')
      .withExactArgs(STORAGE_KEY_DISMISSALS, /* useLocalStorage */ true)
      .returns(Promise.resolve(null))
      .once();
    miniPromptApiMock.expects('create').never();

    await autoPromptManager.showAutoPrompt({
      autoPromptType: AutoPromptType.CONTRIBUTION,
      alwaysShow: false,
      displayLargePromptFn: alternatePromptSpy,
    });
    expect(alternatePromptSpy).to.not.be.called;
  });

  it('should display the mini prompt if the auto prompt config caps impressions, and the user is under the cap', async () => {
    const entitlements = new Entitlements();
    entitlementsManagerMock
      .expects('getEntitlements')
      .returns(Promise.resolve(entitlements))
      .once();
    const autoPromptConfig = new AutoPromptConfig(/* maxImpressionsPerWeek*/ 2);
    const clientConfig = new ClientConfig({autoPromptConfig});
    clientConfigManagerMock
      .expects('getClientConfig')
      .returns(Promise.resolve(clientConfig))
      .once();
    // One stored impression.
    const storedImpressions = CURRENT_TIME.toString();
    storageMock
      .expects('get')
      .withExactArgs(STORAGE_KEY_IMPRESSIONS, /* useLocalStorage */ true)
      .returns(Promise.resolve(storedImpressions))
      .once();
    storageMock
      .expects('get')
      .withExactArgs(STORAGE_KEY_DISMISSALS, /* useLocalStorage */ true)
      .returns(Promise.resolve(null))
      .once();
    miniPromptApiMock.expects('create').once();

    await autoPromptManager.showAutoPrompt({
      autoPromptType: AutoPromptType.CONTRIBUTION,
      alwaysShow: false,
      displayLargePromptFn: alternatePromptSpy,
    });
    expect(alternatePromptSpy).to.not.be.called;
  });

  it('should display the large prompt if the auto prompt config caps impressions, and the user is under the cap', async () => {
    const entitlements = new Entitlements();
    entitlementsManagerMock
      .expects('getEntitlements')
      .returns(Promise.resolve(entitlements))
      .once();
    const autoPromptConfig = new AutoPromptConfig(/* maxImpressionsPerWeek*/ 2);
    const clientConfig = new ClientConfig({autoPromptConfig});
    clientConfigManagerMock
      .expects('getClientConfig')
      .returns(Promise.resolve(clientConfig))
      .once();
    storageMock
      .expects('get')
      .withExactArgs(STORAGE_KEY_IMPRESSIONS, /* useLocalStorage */ true)
      .returns(Promise.resolve(null))
      .once();
    storageMock
      .expects('get')
      .withExactArgs(STORAGE_KEY_DISMISSALS, /* useLocalStorage */ true)
      .returns(Promise.resolve(null))
      .once();
    miniPromptApiMock.expects('create').never();

    await autoPromptManager.showAutoPrompt({
      autoPromptType: AutoPromptType.CONTRIBUTION_LARGE,
      alwaysShow: false,
      displayLargePromptFn: alternatePromptSpy,
    });

    await tick(2);
    expect(alternatePromptSpy).to.be.calledOnce;
  });

  it('should display the mini prompt if the auto prompt config caps impressions, and the user is under the cap after discounting old impressions', async () => {
    const entitlements = new Entitlements();
    entitlementsManagerMock
      .expects('getEntitlements')
      .returns(Promise.resolve(entitlements))
      .once();
    const autoPromptConfig = new AutoPromptConfig(/* maxImpressionsPerWeek*/ 2);
    const clientConfig = new ClientConfig({autoPromptConfig});
    clientConfigManagerMock
      .expects('getClientConfig')
      .returns(Promise.resolve(clientConfig))
      .once();
    // Two stored impressions, the first from 2 weeks ago.
    const twoWeeksInMs = 1209600000;
    const storedImpressions =
      (CURRENT_TIME - twoWeeksInMs).toString() + ',' + CURRENT_TIME.toString();
    storageMock
      .expects('get')
      .withExactArgs(STORAGE_KEY_IMPRESSIONS, /* useLocalStorage */ true)
      .returns(Promise.resolve(storedImpressions))
      .once();
    storageMock
      .expects('get')
      .withExactArgs(STORAGE_KEY_DISMISSALS, /* useLocalStorage */ true)
      .returns(Promise.resolve(null))
      .once();
    miniPromptApiMock.expects('create').once();

    await autoPromptManager.showAutoPrompt({
      autoPromptType: AutoPromptType.CONTRIBUTION,
      alwaysShow: false,
      displayLargePromptFn: alternatePromptSpy,
    });
    expect(alternatePromptSpy).to.not.be.called;
  });

  it('should not display the mini prompt if the auto prompt config caps dismissals, and the user is over the cap', async () => {
    const entitlements = new Entitlements();
    entitlementsManagerMock
      .expects('getEntitlements')
      .returns(Promise.resolve(entitlements))
      .once();
    const autoPromptConfig = new AutoPromptConfig(
      /* maxImpressionsPerWeek */ 2,
      /* displayDelaySeconds */ 0,
      /* backoffSeconds */ 0,
      /* maxDismissalsPerWeek */ 1,
      /* maxDismissalsResultingHideSeconds */ 10
    );
    const clientConfig = new ClientConfig({autoPromptConfig});
    clientConfigManagerMock
      .expects('getClientConfig')
      .returns(Promise.resolve(clientConfig))
      .once();
    // One stored impression from 10ms ago and one dismissal from 5ms ago.
    const storedImpressions = (CURRENT_TIME - 10).toString();
    const storedDismissals = (CURRENT_TIME - 5).toString();
    storageMock
      .expects('get')
      .withExactArgs(STORAGE_KEY_IMPRESSIONS, /* useLocalStorage */ true)
      .returns(Promise.resolve(storedImpressions))
      .once();
    storageMock
      .expects('get')
      .withExactArgs(STORAGE_KEY_DISMISSALS, /* useLocalStorage */ true)
      .returns(Promise.resolve(storedDismissals))
      .once();
    miniPromptApiMock.expects('create').never();

    await autoPromptManager.showAutoPrompt({
      autoPromptType: AutoPromptType.CONTRIBUTION,
      alwaysShow: false,
      displayLargePromptFn: alternatePromptSpy,
    });
    expect(alternatePromptSpy).to.not.be.called;
  });

  it('should display the mini prompt if the auto prompt config caps dismissals, and the user is over the cap, but sufficient time has passed since the specified hide duration', async () => {
    const entitlements = new Entitlements();
    entitlementsManagerMock
      .expects('getEntitlements')
      .returns(Promise.resolve(entitlements))
      .once();
    const autoPromptConfig = new AutoPromptConfig(
      /* maxImpressionsPerWeek */ 2,
      /* displayDelaySeconds */ 0,
      /* backoffSeconds */ 0,
      /* maxDismissalsPerWeek */ 1,
      /* maxDismissalsResultingHideSeconds */ 10
    );
    const clientConfig = new ClientConfig({autoPromptConfig});
    clientConfigManagerMock
      .expects('getClientConfig')
      .returns(Promise.resolve(clientConfig))
      .once();
    // One stored impression from 20s ago and one dismissal from 11s ago.
    const storedImpressions = (CURRENT_TIME - 20000).toString();
    const storedDismissals = (CURRENT_TIME - 11000).toString();
    storageMock
      .expects('get')
      .withExactArgs(STORAGE_KEY_IMPRESSIONS, /* useLocalStorage */ true)
      .returns(Promise.resolve(storedImpressions))
      .once();
    storageMock
      .expects('get')
      .withExactArgs(STORAGE_KEY_DISMISSALS, /* useLocalStorage */ true)
      .returns(Promise.resolve(storedDismissals))
      .once();
    miniPromptApiMock.expects('create').once();

    await autoPromptManager.showAutoPrompt({
      autoPromptType: AutoPromptType.CONTRIBUTION,
      alwaysShow: false,
      displayLargePromptFn: alternatePromptSpy,
    });
    expect(alternatePromptSpy).to.not.be.called;
  });

  it('should not display the mini prompt if the auto prompt config caps dismissals, and the user is under the cap, but sufficient time has not yet passed since the specified hide duration', async () => {
    const entitlements = new Entitlements();
    entitlementsManagerMock
      .expects('getEntitlements')
      .returns(Promise.resolve(entitlements))
      .once();
    const autoPromptConfig = new AutoPromptConfig(
      /* maxImpressionsPerWeek */ 2,
      /* displayDelaySeconds */ 0,
      /* backoffSeconds */ 10,
      /* maxDismissalsPerWeek */ 2,
      /* maxDismissalsResultingHideSeconds */ 5
    );
    const clientConfig = new ClientConfig({autoPromptConfig});
    clientConfigManagerMock
      .expects('getClientConfig')
      .returns(Promise.resolve(clientConfig))
      .once();
    // One stored impression from 20s ago and one dismissal from 6s ago.
    const storedImpressions = (CURRENT_TIME - 20000).toString();
    const storedDismissals = (CURRENT_TIME - 6000).toString();
    storageMock
      .expects('get')
      .withExactArgs(STORAGE_KEY_IMPRESSIONS, /* useLocalStorage */ true)
      .returns(Promise.resolve(storedImpressions))
      .once();
    storageMock
      .expects('get')
      .withExactArgs(STORAGE_KEY_DISMISSALS, /* useLocalStorage */ true)
      .returns(Promise.resolve(storedDismissals))
      .once();
    miniPromptApiMock.expects('create').never();

    await autoPromptManager.showAutoPrompt({
      autoPromptType: AutoPromptType.CONTRIBUTION,
      alwaysShow: false,
      displayLargePromptFn: alternatePromptSpy,
    });
    expect(alternatePromptSpy).to.not.be.called;
  });

  it('should display the mini prompt if the auto prompt config caps dismissals, and the user is under the cap, and sufficient time has passed since the specified hide duration', async () => {
    const entitlements = new Entitlements();
    entitlementsManagerMock
      .expects('getEntitlements')
      .returns(Promise.resolve(entitlements))
      .once();
    const autoPromptConfig = new AutoPromptConfig(
      /* maxImpressionsPerWeek */ 2,
      /* displayDelaySeconds */ 0,
      /* backoffSeconds */ 5,
      /* maxDismissalsPerWeek */ 2,
      /* maxDismissalsResultingHideSeconds */ 10
    );
    const clientConfig = new ClientConfig({autoPromptConfig});
    clientConfigManagerMock
      .expects('getClientConfig')
      .returns(Promise.resolve(clientConfig))
      .once();
    // One stored impression from 20s ago and one dismissal from 6s ago.
    const storedImpressions = (CURRENT_TIME - 20000).toString();
    const storedDismissals = (CURRENT_TIME - 6000).toString();
    storageMock
      .expects('get')
      .withExactArgs(STORAGE_KEY_IMPRESSIONS, /* useLocalStorage */ true)
      .returns(Promise.resolve(storedImpressions))
      .once();
    storageMock
      .expects('get')
      .withExactArgs(STORAGE_KEY_DISMISSALS, /* useLocalStorage */ true)
      .returns(Promise.resolve(storedDismissals))
      .once();
    miniPromptApiMock.expects('create').once();

    await autoPromptManager.showAutoPrompt({
      autoPromptType: AutoPromptType.CONTRIBUTION,
      alwaysShow: false,
      displayLargePromptFn: alternatePromptSpy,
    });
    expect(alternatePromptSpy).to.not.be.called;
  });

  it('should display the subscription mini prompt if the user has no entitlements', async () => {
    const entitlements = new Entitlements();
    entitlementsManagerMock
      .expects('getEntitlements')
      .returns(Promise.resolve(entitlements))
      .once();
    const clientConfig = new ClientConfig();
    clientConfigManagerMock
      .expects('getClientConfig')
      .returns(Promise.resolve(clientConfig))
      .once();
    miniPromptApiMock.expects('create').never();

    await autoPromptManager.showAutoPrompt({
      autoPromptType: AutoPromptType.SUBSCRIPTION,
      alwaysShow: false,
      displayLargePromptFn: alternatePromptSpy,
    });
    expect(alternatePromptSpy).to.not.be.called;
  });

  it('should not display any prompt if the user has a valid entitlement', async () => {
    const entitlements = new Entitlements();
    sandbox.stub(entitlements, 'enablesThis').returns(true);
    entitlementsManagerMock
      .expects('getEntitlements')
      .returns(Promise.resolve(entitlements))
      .once();
    const clientConfig = new ClientConfig();
    clientConfigManagerMock
      .expects('getClientConfig')
      .returns(Promise.resolve(clientConfig))
      .once();
    miniPromptApiMock.expects('create').never();

    await autoPromptManager.showAutoPrompt({
      autoPromptType: AutoPromptType.CONTRIBUTION,
      alwaysShow: false,
      displayLargePromptFn: alternatePromptSpy,
    });
    expect(alternatePromptSpy).to.not.be.called;
  });

  it('should display the alternate prompt if the user has no entitlements, but the content is paygated', async () => {
    sandbox.stub(pageConfig, 'isLocked').returns(true);
    const entitlements = new Entitlements();
    entitlementsManagerMock
      .expects('getEntitlements')
      .returns(Promise.resolve(entitlements))
      .once();
    const clientConfig = new ClientConfig();
    clientConfigManagerMock
      .expects('getClientConfig')
      .returns(Promise.resolve(clientConfig))
      .once();
    miniPromptApiMock.expects('create').never();

    await autoPromptManager.showAutoPrompt({
      autoPromptType: AutoPromptType.CONTRIBUTION,
      alwaysShow: false,
      displayLargePromptFn: alternatePromptSpy,
    });

    expect(alternatePromptSpy).to.be.calledOnce;
  });

  it('should not display any prompt if UI predicate is false', async () => {
    sandbox.stub(pageConfig, 'isLocked').returns(false);
    const entitlements = new Entitlements();
    sandbox.stub(entitlements, 'enablesThis').returns(true);
    entitlementsManagerMock
      .expects('getEntitlements')
      .returns(Promise.resolve(entitlements))
      .once();

    const autoPromptConfig = new AutoPromptConfig();
    const uiPredicates = new UiPredicates(
      /* canDisplayAutoPrompt */ false,
      /* canDisplayButton */ true
    );
    const clientConfig = new ClientConfig({
      autoPromptConfig,
      useUpdatedOfferFlows: true,
      uiPredicates,
    });
    clientConfigManagerMock
      .expects('getClientConfig')
      .returns(Promise.resolve(clientConfig))
      .once();
    miniPromptApiMock.expects('create').never();

    await autoPromptManager.showAutoPrompt({
      autoPromptType: AutoPromptType.CONTRIBUTION,
      alwaysShow: false,
      displayLargePromptFn: alternatePromptSpy,
    });
    expect(alternatePromptSpy).to.not.be.called;
  });

  it('should display the contribution mini prompt if the user has no entitlements and UI predicate is true', async () => {
    const entitlements = new Entitlements();
    entitlementsManagerMock
      .expects('getEntitlements')
      .returns(Promise.resolve(entitlements))
      .once();

    const autoPromptConfig = new AutoPromptConfig();
    const uiPredicates = new UiPredicates(
      /* canDisplayAutoPrompt */ true,
      /* canDisplayButton */ true
    );
    const clientConfig = new ClientConfig({
      autoPromptConfig,
      useUpdatedOfferFlows: true,
      uiPredicates,
    });
    clientConfigManagerMock
      .expects('getClientConfig')
      .returns(Promise.resolve(clientConfig))
      .once();
    miniPromptApiMock.expects('create').once();

    await autoPromptManager.showAutoPrompt({
      autoPromptType: AutoPromptType.CONTRIBUTION,
      alwaysShow: false,
      displayLargePromptFn: alternatePromptSpy,
    });
    expect(alternatePromptSpy).to.not.be.called;
  });
});
