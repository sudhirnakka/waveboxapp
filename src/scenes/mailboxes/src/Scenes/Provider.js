import React from 'react'
import WaveboxRouter from './WaveboxRouter'
import constants from 'shared/constants'
import shallowCompare from 'react-addons-shallow-compare'
import THEME_MAPPING from 'wbui/Themes/ThemeMapping'
import { MuiThemeProvider } from '@material-ui/core/styles'
import { accountStore, accountDispatch } from 'stores/account'
import { settingsStore } from 'stores/settings'
import { googleActions } from 'stores/google'
import { trelloActions } from 'stores/trello'
import { slackActions } from 'stores/slack'
import { microsoftActions } from 'stores/microsoft'
import { updaterActions } from 'stores/updater'
import { Analytics, ServerVent } from 'Server'
import { NotificationService } from 'Notifications'
import Bootstrap from 'R/Bootstrap'
import AccountMessageDispatcher from './AccountMessageDispatcher'
import { Tray } from 'Components/Tray'
import { AppBadge, WindowTitle } from 'Components'
import { remote } from 'electron'
import ErrorBoundary from 'wbui/ErrorBoundary'
import classNames from 'classnames'
import ProviderIpcDispatcher from './ProviderIpcDispatcher'

export default class Provider extends React.Component {
  /* **************************************************************************/
  // Lifecycle
  /* **************************************************************************/

  componentWillMount () {
    this.customCSSElement = null
  }

  componentDidMount () {
    // STEP 0. Maintaining focus
    this.refocusTO = null
    this.forceFocusTO = null
    remote.getCurrentWindow().on('focus', this.handleWindowFocused)

    // STEP 1. App services
    Analytics.startAutoreporting()
    ServerVent.start(Bootstrap.clientId, Bootstrap.clientToken)
    NotificationService.start()
    updaterActions.load()

    // STEP 2. Mailbox connections
    googleActions.startPollingUpdates()
    trelloActions.startPollingUpdates()
    slackActions.connectAllServices()
    microsoftActions.startPollingUpdates()

    // STEP 3. Listen for self
    accountStore.listen(this.accountChanged)
    settingsStore.listen(this.settingsChanged)
    accountDispatch.on('blurred', this.serviceBlurred)

    // Step 4. Customizations
    if (this.state.uiSettings.customMainCSS) {
      this.renderCustomCSS(this.state.uiSettings.customMainCSS)
    }
  }

  componentWillUnmount () {
    clearTimeout(this.refocusTO)
    clearInterval(this.forceFocusTO)
    remote.getCurrentWindow().removeListener('focus', this.handleWindowFocused)

    // STEP 1. App services
    Analytics.stopAutoreporting()
    ServerVent.stop()
    NotificationService.stop()
    updaterActions.unload()

    // STEP 2. Mailbox connections
    googleActions.stopPollingUpdates()
    trelloActions.stopPollingUpdates()
    slackActions.disconnectAllServices()
    microsoftActions.stopPollingUpdates()

    // STEP 3. Listening for self
    accountStore.unlisten(this.accountChanged)
    settingsStore.unlisten(this.settingsChanged)
    accountDispatch.removeListener('blurred', this.serviceBlurred)

    // STEP 4. Customizations
    this.renderCustomCSS(null)
  }

  componentDidUpdate (prevProps, prevState) {
    if (prevState.uiSettings.customMainCSS !== this.state.uiSettings.customMainCSS) {
      this.renderCustomCSS(this.state.uiSettings.customMainCSS)
    }
  }

  /* **************************************************************************/
  // Data lifecycle
  /* **************************************************************************/

  state = (() => {
    const settingsState = settingsStore.getState()
    const accountState = accountStore.getState()
    return {
      messagesUnreadCount: accountState.userUnreadCountForApp(),
      hasUnreadActivity: accountState.userUnreadActivityForApp(),
      uiSettings: settingsState.ui,
      traySettings: settingsState.tray,
      launchTraySettings: settingsState.launched.tray,
      activeMailboxId: accountState.activeMailboxId(),
      activeServiceId: accountState.activeServiceId()
    }
  })()

  accountChanged = (accountState) => {
    this.setState({
      messagesUnreadCount: accountState.userUnreadCountForApp(),
      hasUnreadActivity: accountState.userUnreadActivityForApp(),
      activeMailboxId: accountState.activeMailboxId(),
      activeServiceId: accountState.activeServiceId()
    })
  }

  settingsChanged = (settingsState) => {
    this.setState({
      uiSettings: settingsState.ui,
      traySettings: settingsState.tray
    })
  }

  /* **************************************************************************/
  // Rendering Events
  /* **************************************************************************/

  /**
  * Handles a mailbox bluring by trying to refocus the mailbox
  * @param evt: the event that fired
  */
  serviceBlurred = (evt) => {
    // Requeue the event to run on the end of the render cycle
    clearTimeout(this.refocusTO)
    this.refocusTO = setTimeout(() => {
      const active = document.activeElement
      if (active.tagName === 'WEBVIEW') {
        // Nothing to do, already focused on mailbox
        clearInterval(this.forceFocusTO)
      } else if (active.tagName === 'BODY') {
        // Focused on body, just dip focus onto the webview
        clearInterval(this.forceFocusTO)
        accountDispatch.refocus()
      } else {
        // focused on some element in the ui, poll until we move back to body
        this.forceFocusTO = setInterval(() => {
          if (document.activeElement.tagName === 'BODY') {
            clearInterval(this.forceFocusTO)
            accountDispatch.refocus()
          }
        }, constants.REFOCUS_MAILBOX_INTERVAL_MS)
      }
    }, constants.REFOCUS_MAILBOX_INTERVAL_MS)
  }

  /**
  * Handles the window refocusing by pointing the focus back onto the active mailbox
  */
  handleWindowFocused = () => {
    if (window.location.hash.length < 2) {
      accountDispatch.refocus()
    }
  }

  /* **************************************************************************/
  // Rendering
  /* **************************************************************************/

  shouldComponentUpdate (nextProps, nextState) {
    return shallowCompare(this, nextProps, nextState)
  }

  /**
  * Renders the custom css into the dom
  * @param css: the css to render
  */
  renderCustomCSS (css) {
    if (css) {
      if (!this.customCSSElement) {
        this.customCSSElement = document.createElement('style')
        this.customCSSElement.setAttribute('data-custom-css', 'true')
        document.head.appendChild(this.customCSSElement)
      }
      this.customCSSElement.innerHTML = css
    } else {
      if (this.customCSSElement) {
        this.customCSSElement.parentElement.removeChild(this.customCSSElement)
        this.customCSSElement = null
      }
    }
  }

  render () {
    const {
      traySettings,
      launchTraySettings,
      uiSettings,
      messagesUnreadCount,
      hasUnreadActivity,
      activeMailboxId,
      activeServiceId
    } = this.state

    return (
      <div className={classNames('WB-Provider', `WB-Id-${activeMailboxId}-${activeServiceId}`)}>
        <MuiThemeProvider theme={THEME_MAPPING[uiSettings.theme]}>
          <WaveboxRouter />
        </MuiThemeProvider>
        <ErrorBoundary>
          <ProviderIpcDispatcher />
        </ErrorBoundary>
        <ErrorBoundary>
          <AccountMessageDispatcher />
        </ErrorBoundary>
        <ErrorBoundary>
          <WindowTitle />
        </ErrorBoundary>
        {traySettings.show ? (
          <ErrorBoundary>
            <Tray
              unreadCount={messagesUnreadCount}
              hasUnreadActivity={hasUnreadActivity}
              launchTraySettings={launchTraySettings}
              traySettings={traySettings} />
          </ErrorBoundary>
        ) : undefined}
        {uiSettings.showAppBadge ? (
          <ErrorBoundary>
            <AppBadge
              unreadCount={messagesUnreadCount}
              hasUnreadActivity={hasUnreadActivity} />
          </ErrorBoundary>
        ) : undefined}
      </div>
    )
  }
}
