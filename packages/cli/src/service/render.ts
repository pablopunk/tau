import type { ServiceSpec } from "./spec";

const xmlEscape = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export function renderPlist(spec: ServiceSpec): string {
  const programArguments = [spec.command, ...spec.args]
    .map((argument) => `    <string>${xmlEscape(argument)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(spec.names.launchdLabel)}</string>
  <key>ProgramArguments</key>
  <array>
${programArguments}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xmlEscape(spec.path)}</string>
  </dict>
</dict>
</plist>
`;
}

const systemdQuote = (text: string) =>
  `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%")}"`;

export function renderSystemdUnit(spec: ServiceSpec): string {
  const command = [spec.command, ...spec.args].map(systemdQuote).join(" ");
  return `[Unit]
Description=tau server

[Service]
ExecStart=${command}
Restart=always
RestartSec=5
Environment=${systemdQuote(`PATH=${spec.path}`)}

[Install]
WantedBy=default.target
`;
}

export function renderTaskXml(wrapperPath: string): string {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
    <StartWhenAvailable>true</StartWhenAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Hidden>true</Hidden>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>conhost.exe</Command>
      <Arguments>--headless "${xmlEscape(wrapperPath)}"</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}

const cmdQuote = (text: string) => `"${text.replaceAll("%", "%%")}"`;

export function renderCmdWrapper(spec: ServiceSpec): string {
  const command = [spec.command, ...spec.args].map(cmdQuote).join(" ");
  return `@echo off\r
set "PATH=${spec.path.replaceAll("%", "%%")}"\r
${command}\r
exit /b %ERRORLEVEL%\r
`;
}
