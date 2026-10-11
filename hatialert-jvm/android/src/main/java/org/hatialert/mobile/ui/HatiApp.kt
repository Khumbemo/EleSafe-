package org.hatialert.mobile.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
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
            if (signedIn) {
                NavigationBar {
                    for (tab in TABS) {
                        NavigationBarItem(
                            selected = screen == tab.screen || (tab.screen == Screen.Cases && screen is Screen.CaseDetail),
                            onClick = {
                                c.navigate(tab.screen)
                                tab.load?.let { vm.act(it) }
                            },
                            icon = { Icon(tab.icon, contentDescription = null) },
                            label = { Text(tab.label) },
                        )
                    }
                }
            }
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when (screen) {
                Screen.SignIn -> SignInScreen(st, vm)
                Screen.Home -> HomeScreen(st, onOpen = { id -> vm.act { openCase(id) } })
                Screen.Report -> ReportScreen(st, vm)
                Screen.Cases -> CasesScreen(st, onOpen = { id -> vm.act { openCase(id) } })
                is Screen.CaseDetail -> CaseDetailScreen(st, vm)
                Screen.Alerts -> AlertsScreen(st)
                Screen.Settings -> SettingsScreen(st, vm)
            }
            if (st.isBusy) LinearProgressIndicator(Modifier.fillMaxWidth())
        }
    }
}
