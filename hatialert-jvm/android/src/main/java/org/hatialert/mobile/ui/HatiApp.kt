package org.hatialert.mobile.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import org.hatialert.client.app.AdminSection
import org.hatialert.client.app.AppController
import org.hatialert.client.app.Screen
import org.hatialert.mobile.AppViewModel

private data class Tab(val screen: Screen, val label: String, val icon: ImageVector, val load: (suspend AppController.() -> Unit)?)

private val TABS = listOf(
    Tab(Screen.Home, "Home", Icons.Filled.Home) { refreshHome() },
    Tab(Screen.Report, "Report", Icons.Filled.Add, null),
    Tab(Screen.Cases, "Cases", Icons.AutoMirrored.Filled.List) { loadCases() },
    Tab(Screen.Alerts, "Alerts", Icons.Filled.Notifications) { loadAlerts() },
    Tab(Screen.Settings, "Settings", Icons.Filled.Settings, null),
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HatiApp(vm: AppViewModel) {
    val st by vm.state.collectAsState()
    val snackbar = remember { SnackbarHostState() }
    val c = vm.controller
    val win = rememberWindowLayout()
    fun go(tab: Tab) {
        c.navigate(tab.screen)
        tab.load?.let { vm.act(it) }
    }

    LaunchedEffect(st.message) {
        val m = st.message ?: return@LaunchedEffect
        snackbar.showSnackbar(m.text, withDismissAction = true)
        c.dismissMessage()
    }

    // Thumbnails belong to the account that could see them.
    LaunchedEffect(st.user?.id) { vm.thumbnails.evictAll() }

    val user = st.user
    val signedIn = user != null
    val screen = when {
        user == null -> if (st.screen in Screen.SIGNED_OUT) st.screen else Screen.SignIn
        user.mustChangePin -> Screen.NewPin
        else -> st.screen
    }
    // The app's own screens only once the server is happy with the PIN.
    val inApp = signedIn && screen != Screen.NewPin
    val back = backFrom(screen)
    BackHandler(enabled = back != null) { back?.let { c.navigate(it) } }

    val title = when (screen) {
        Screen.SignIn -> "HatiAlert"
        Screen.Register -> "Create an account"
        Screen.ForgotPin -> "Forgot your PIN?"
        Screen.NewPin -> "HatiAlert"
        Screen.Home -> st.homeVillage?.name ?: "Home"
        Screen.Report -> "Report an incident"
        Screen.Cases -> if (st.user?.isStaff == true) "All cases" else "My reports"
        is Screen.CaseDetail -> st.detail?.ref ?: "Case"
        Screen.Alerts -> "Alerts"
        Screen.ComposeAlert -> "Send an alert"
        Screen.Settings -> "Settings"
        is Screen.Admin -> if (screen.section == AdminSection.STATS) "District overview" else "Admin"
    }
    val refresh: (suspend AppController.() -> Unit)? = when (screen) {
        is Screen.CaseDetail -> ({ openCase(screen.id) })
        is Screen.Admin -> ({ admin.load(screen.section) })
        else -> TABS.firstOrNull { it.screen == screen }?.load
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title) },
                navigationIcon = {
                    if (back != null && back != Screen.Home) {
                        IconButton(onClick = { c.navigate(back) }) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = tr("Back"))
                        }
                    }
                },
                actions = {
                    if (inApp && refresh != null) {
                        IconButton(onClick = { vm.act(refresh) }) { Icon(Icons.Filled.Refresh, contentDescription = tr("Refresh")) }
                    }
                },
            )
        },
        bottomBar = {
            if (inApp && !win.rail) {
                NavigationBar {
                    for (tab in TABS) {
                        NavigationBarItem(
                            selected = isSelected(tab, screen),
                            onClick = { go(tab) },
                            icon = { Icon(tab.icon, contentDescription = null) },
                            label = { Text(tab.label) },
                        )
                    }
                }
            }
        },
        snackbarHost = { SnackbarHost(snackbar) },
        // safeDrawing also keeps content clear of a camera cut-out and of the
        // navigation bar when a phone is held sideways.
        contentWindowInsets = WindowInsets.safeDrawing,
    ) { padding ->
        Row(Modifier.fillMaxSize().padding(padding)) {
            if (inApp && win.rail) {
                NavigationRail(windowInsets = WindowInsets(0, 0, 0, 0)) {
                    for (tab in TABS) {
                        NavigationRailItem(
                            selected = isSelected(tab, screen),
                            onClick = { go(tab) },
                            icon = { Icon(tab.icon, contentDescription = null) },
                            label = { Text(tab.label) },
                        )
                    }
                }
            }
            Box(Modifier.weight(1f).fillMaxHeight()) {
                val openCase: (Long) -> Unit = { id -> vm.act { openCase(id) } }
                val centred = Modifier.align(Alignment.TopCenter).readable()
                when {
                    win.twoPane && (screen == Screen.Cases || screen is Screen.CaseDetail) -> Row(Modifier.fillMaxSize()) {
                        Box(Modifier.weight(0.42f).fillMaxHeight()) { CasesScreen(st, onOpen = openCase) }
                        VerticalDivider()
                        Box(Modifier.weight(0.58f).fillMaxHeight()) {
                            if (screen is Screen.CaseDetail) {
                                Box(Modifier.align(Alignment.TopCenter).readable()) { CaseDetailScreen(st, vm) }
                            } else {
                                Text(tr("Choose a case to see its details."), modifier = Modifier.align(Alignment.Center).padding(24.dp), color = argb(LocalPalette.current.muted))
                            }
                        }
                    }
                    screen == Screen.Home -> HomeScreen(st, win, onOpen = openCase, onSendNow = { vm.act { flushOutbox() } })
                    else -> Box(centred) {
                        when (screen) {
                            Screen.SignIn -> SignInScreen(st, vm)
                            Screen.Register -> RegisterScreen(st, vm)
                            Screen.ForgotPin -> ForgotPinScreen(st, vm)
                            Screen.NewPin -> NewPinScreen(st, vm)
                            Screen.Report -> ReportScreen(st, vm)
                            Screen.Cases -> CasesScreen(st, onOpen = openCase)
                            is Screen.CaseDetail -> CaseDetailScreen(st, vm)
                            Screen.Alerts -> AlertsScreen(st, onCompose = { c.composeAlert() }, onOpenCase = openCase)
                            Screen.ComposeAlert -> ComposeAlertScreen(st, vm)
                            Screen.Settings -> SettingsScreen(st, vm)
                            is Screen.Admin -> AdminScreen(st, vm, screen.section)
                            Screen.Home -> Unit
                        }
                    }
                }
                if (st.isBusy) LinearProgressIndicator(Modifier.fillMaxWidth())
            }
        }
    }
}

private fun isSelected(tab: Tab, screen: Screen): Boolean =
    screen == tab.screen ||
        (tab.screen == Screen.Cases && screen is Screen.CaseDetail) ||
        (tab.screen == Screen.Alerts && screen == Screen.ComposeAlert) ||
        (tab.screen == Screen.Settings && screen is Screen.Admin)

/** Where Back goes from [screen], or null to leave it to the system (close the app). */
private fun backFrom(screen: Screen): Screen? = when (screen) {
    Screen.SignIn, Screen.Home, Screen.NewPin -> null
    Screen.Register, Screen.ForgotPin -> Screen.SignIn
    is Screen.CaseDetail -> Screen.Cases
    Screen.ComposeAlert -> Screen.Alerts
    is Screen.Admin -> Screen.Settings
    else -> Screen.Home
}
