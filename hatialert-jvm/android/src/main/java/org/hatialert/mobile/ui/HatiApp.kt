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

    val signedIn = st.user != null
    val screen = if (signedIn) st.screen else Screen.SignIn
    BackHandler(enabled = signedIn && screen != Screen.Home) {
        c.navigate(if (screen is Screen.CaseDetail) Screen.Cases else Screen.Home)
    }

    val title = when (screen) {
        Screen.SignIn -> "HatiAlert"
        Screen.Home -> st.homeVillage?.name ?: "Home"
        Screen.Report -> "Report an incident"
        Screen.Cases -> if (st.user?.isStaff == true) "All cases" else "My reports"
        is Screen.CaseDetail -> st.detail?.ref ?: "Case"
        Screen.Alerts -> "Alerts"
        Screen.Settings -> "Settings"
    }
    val refresh: (suspend AppController.() -> Unit)? = when (screen) {
        is Screen.CaseDetail -> ({ openCase(screen.id) })
        else -> TABS.firstOrNull { it.screen == screen }?.load
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title) },
                navigationIcon = {
                    if (screen is Screen.CaseDetail) {
                        IconButton(onClick = { c.navigate(Screen.Cases) }) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                        }
                    }
                },
                actions = {
                    if (signedIn && refresh != null) {
                        IconButton(onClick = { vm.act(refresh) }) { Icon(Icons.Filled.Refresh, contentDescription = "Refresh") }
                    }
                },
            )
        },
        bottomBar = {
            if (signedIn && !win.rail) {
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
            if (signedIn && win.rail) {
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
                                Text("Choose a case to see its details.", modifier = Modifier.align(Alignment.Center).padding(24.dp), color = argb(LocalPalette.current.muted))
                            }
                        }
                    }
                    screen == Screen.Home -> HomeScreen(st, win, onOpen = openCase)
                    else -> Box(centred) {
                        when (screen) {
                            Screen.SignIn -> SignInScreen(st, vm)
                            Screen.Report -> ReportScreen(st, vm)
                            Screen.Cases -> CasesScreen(st, onOpen = openCase)
                            is Screen.CaseDetail -> CaseDetailScreen(st, vm)
                            Screen.Alerts -> AlertsScreen(st)
                            Screen.Settings -> SettingsScreen(st, vm)
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
    screen == tab.screen || (tab.screen == Screen.Cases && screen is Screen.CaseDetail)
