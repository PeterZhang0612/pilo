use std::{net::Ipv4Addr, time::Duration};

use tokio::process::Command;

pub(crate) async fn list_lan_ips() -> Result<Vec<String>, String> {
    let mut command = if cfg!(windows) {
        let mut command = Command::new("powershell.exe");
        command.args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$ErrorActionPreference = 'Stop'; \
             [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() | \
             Where-Object { $_.OperationalStatus -eq 'Up' } | \
             ForEach-Object { $_.GetIPProperties().UnicastAddresses } | \
             Where-Object { $_.Address.AddressFamily -eq 'InterNetwork' } | \
             ForEach-Object { 'inet ' + $_.Address.ToString() }",
        ]);
        command
    } else if cfg!(target_os = "macos") {
        let mut command = Command::new("ifconfig");
        command.arg("-u");
        command
    } else {
        let mut command = Command::new("ip");
        command.args(["-o", "-4", "addr", "show", "up"]);
        command
    };
    crate::runtime::hide_console_window(&mut command);
    command.kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(5), command.output())
        .await
        .map_err(|_| "timed out while listing LAN addresses".to_owned())?
        .map_err(|error| format!("failed to list LAN addresses: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "failed to list LAN addresses: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    // The Remote WebUI listener binds IPv4 only; do not advertise IPv6 targets.
    let mut addresses = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            line.split_whitespace()
                .skip_while(|word| *word != "inet")
                .nth(1)?
                .split('/')
                .next()?
                .parse::<Ipv4Addr>()
                .ok()
        })
        .filter(|ip| {
            !ip.is_loopback()
                && !ip.is_unspecified()
                && !ip.is_link_local()
                && !ip.is_multicast()
                && !ip.is_broadcast()
        })
        .collect::<Vec<_>>();
    addresses.sort_unstable();
    addresses.dedup();
    Ok(addresses.into_iter().map(|ip| ip.to_string()).collect())
}
