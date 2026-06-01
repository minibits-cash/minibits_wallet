package com.minibits_wallet

// minibits_wallet:react-native-screens
import android.content.Intent
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

open class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "minibits_wallet"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  // minibits_wallet:react-native-screens
  override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(null)
    }

  /**
   * This activity is launchMode="singleTask", so when an NFC tap (or deep link) arrives while
   * the app is already running it is delivered here via onNewIntent rather than a fresh start.
   * super.onNewIntent forwards the intent to React Native's ActivityEventListeners (which the
   * NFC manager and Linking module use), and setIntent updates getIntent() so launch-intent
   * reads (getLaunchTagEvent / Linking.getInitialURL) reflect the new intent on warm resume.
   */
  override fun onNewIntent(intent: Intent) {
      super.onNewIntent(intent)
      setIntent(intent)
  }
}
