param(
  [string]$BaseUrl = $(if ($env:GIRLAGENT_BASE_URL) { $env:GIRLAGENT_BASE_URL } else { "http://127.0.0.1:8787" }),
  [string]$Token = $(if ($env:GIRLAGENT_TOKEN) { $env:GIRLAGENT_TOKEN } else { "verify-token" }),
  [string]$ProviderKey = $env:GIRLAGENT_PROVIDER_KEY,
  [string]$ModelId = "gpt-4.1-mini",
  [string]$PresetId = "",
  [ValidateSet("smoke", "full")][string]$Mode = "smoke",
  [string]$OutputJson = "",
  [switch]$PrintResultJson,
  [switch]$NoStartServer,
  [switch]$RequireReachable,
  [switch]$SkipChat,
  [switch]$VerifyStream,
  [switch]$VerifyStreamAbort,
  [switch]$KeepArtifacts,
  [switch]$KeepServer,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$ExtraArgs
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

foreach ($arg in $ExtraArgs) {
  switch ($arg) {
    "--" { }
    "-NoStartServer" { $NoStartServer = $true }
    "-RequireReachable" { $RequireReachable = $true }
    "-SkipChat" { $SkipChat = $true }
    "-VerifyStream" { $VerifyStream = $true }
    "-VerifyStreamAbort" { $VerifyStreamAbort = $true }
    "-KeepArtifacts" { $KeepArtifacts = $true }
    "-KeepServer" { $KeepServer = $true }
    "-PrintResultJson" { $PrintResultJson = $true }
    default { }
  }
}

if ($Mode -eq "smoke") {
  if (-not $PSBoundParameters.ContainsKey("SkipChat")) {
    $SkipChat = $true
  }
} else {
  if (-not $PSBoundParameters.ContainsKey("RequireReachable")) {
    $RequireReachable = $true
  }
  if (-not $PSBoundParameters.ContainsKey("VerifyStream")) {
    $VerifyStream = $true
  }
}

function Write-Step([string]$message) {
  Write-Host "[verify] $message" -ForegroundColor Cyan
}

function Throw-VerifyError {
  param(
    [Parameter(Mandatory = $true)][string]$Code,
    [Parameter(Mandatory = $true)][string]$Message
  )

  $exception = [System.Exception]::new($Message)
  $exception.Data["VerifyCode"] = $Code
  throw $exception
}

function Write-ResultJson([object]$payload) {
  if ([string]::IsNullOrWhiteSpace($OutputJson)) {
    return
  }

  $candidatePaths = [System.Collections.Generic.List[string]]::new()
  $candidatePaths.Add($OutputJson)

  if ($script:projectRoot) {
    $candidatePaths.Add((Join-Path $script:projectRoot "target\verify-headless-result.json"))
  }
  $candidatePaths.Add((Join-Path (Get-Location).Path "verify-headless-result.json"))
  $candidatePaths.Add((Join-Path ([System.IO.Path]::GetTempPath()) "girlagent-verify-result.json"))

  $jsonText = $payload | ConvertTo-Json -Depth 30
  foreach ($path in $candidatePaths) {
    if ([string]::IsNullOrWhiteSpace($path)) {
      continue
    }
    try {
      $parent = Split-Path -Parent $path
      if ($parent -and (-not (Test-Path $parent))) {
        New-Item -Path $parent -ItemType Directory | Out-Null
      }
      $jsonText | Set-Content -Path $path -Encoding UTF8
      if ($path -ne $OutputJson) {
        Write-Step ("output path not writable, fallback json path: {0}" -f $path)
      }
      return
    } catch {
      continue
    }
  }

  throw [System.Exception]::new("all json output paths are not writable")
}

function New-ApiHeaders([bool]$authEnabled) {
  $headers = @{}
  if ($authEnabled) {
    $headers["Authorization"] = "Bearer $Token"
  }
  return $headers
}

function Invoke-Api {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Path,
    [object]$Body = $null,
    [bool]$Auth = $true
  )

  $uri = "$BaseUrl$Path"
  $headers = New-ApiHeaders -authEnabled $Auth

  if ($null -eq $Body) {
    return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -TimeoutSec 30
  }

  $json = $Body | ConvertTo-Json -Depth 30
  return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -ContentType "application/json" -Body $json -TimeoutSec 30
}

function Invoke-ApiStreamChat {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][object]$Body,
    [switch]$AbortAfterFirstDelta,
    [bool]$Auth = $true
  )

  $uri = "$BaseUrl$Path"
  $httpClient = [System.Net.Http.HttpClient]::new()
  $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, $uri)

  try {
    $httpClient.Timeout = [TimeSpan]::FromSeconds(60)
    $request.Headers.Accept.ParseAdd("text/event-stream")
    if ($Auth) {
      $request.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", $Token)
    }

    $json = $Body | ConvertTo-Json -Depth 30
    $request.Content = [System.Net.Http.StringContent]::new(
      $json,
      [System.Text.Encoding]::UTF8,
      "application/json"
    )

    $response = $httpClient.SendAsync(
      $request,
      [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead
    ).GetAwaiter().GetResult()

    if (-not $response.IsSuccessStatusCode) {
      $errorBody = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
      Throw-VerifyError -Code "STREAM_HTTP_ERROR" -Message ("stream request failed: HTTP {0}, body={1}" -f [int]$response.StatusCode, $errorBody)
    }

    $stream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
    $reader = [System.IO.StreamReader]::new($stream)
    $currentEvent = "message"
    $dataLines = [System.Collections.Generic.List[string]]::new()
    $deltaText = ""
    $donePayload = $null
    $aborted = $false

    while (-not $reader.EndOfStream) {
      $line = $reader.ReadLine()
      if ($null -eq $line) {
        continue
      }

      if ([string]::IsNullOrWhiteSpace($line)) {
        if (($dataLines.Count -gt 0) -or ($currentEvent -ne "message")) {
          $data = [string]::Join("`n", $dataLines)
          if ($currentEvent -eq "delta") {
            try {
              $payload = $data | ConvertFrom-Json
              if ($payload.text) {
                $deltaText += [string]$payload.text
                if ($AbortAfterFirstDelta) {
                  $aborted = $true
                  break
                }
              }
            } catch {
              # ignore malformed delta packet
            }
          } elseif ($currentEvent -eq "done") {
            try {
              $donePayload = $data | ConvertFrom-Json
              break
            } catch {
              Throw-VerifyError -Code "STREAM_DONE_PARSE" -Message "stream done payload parse failed"
            }
          }
        }

        $currentEvent = "message"
        $dataLines.Clear()
        continue
      }

      if ($line.StartsWith("event:")) {
        $currentEvent = $line.Substring(6).Trim()
        continue
      }

      if ($line.StartsWith("data:")) {
        $dataLines.Add($line.Substring(5).TrimStart())
      }
    }

    if ($aborted) {
      return @{
        done = $null
        deltaText = $deltaText
        aborted = $true
      }
    }

    if ($null -eq $donePayload) {
      Throw-VerifyError -Code "STREAM_DONE_MISSING" -Message "stream ended without done event"
    }

    return @{
      done = $donePayload
      deltaText = $deltaText
      aborted = $false
    }
  } finally {
    if ($request) { $request.Dispose() }
    if ($httpClient) { $httpClient.Dispose() }
  }
}

function Wait-Health {
  param(
    [Parameter(Mandatory = $true)][string]$ProbeUrl,
    [System.Diagnostics.Process]$ProcessRef,
    [int]$MaxAttempts = 240
  )

  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    try {
      $health = Invoke-RestMethod -Method GET -Uri "$ProbeUrl/health" -TimeoutSec 2
      if ($health.status -eq "ok") {
        return $true
      }
    } catch {
      # no-op
    }

    if ($ProcessRef -and $ProcessRef.HasExited) {
      return $false
    }

    Start-Sleep -Milliseconds 500
  }

  return $false
}

function Test-HealthOnce([string]$ProbeUrl) {
  try {
    $health = Invoke-RestMethod -Method GET -Uri "$ProbeUrl/health" -TimeoutSec 2
    return $health.status -eq "ok"
  } catch {
    return $false
  }
}

function Test-PortInUse([int]$Port) {
  $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
  return @($listeners | Where-Object { $_.Port -eq $Port }).Count -gt 0
}

function Get-FreeLocalPort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  try {
    $listener.Start()
    return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
  } finally {
    $listener.Stop()
  }
}

$script:projectRoot = Split-Path -Parent $PSScriptRoot
$serverProcess = $null
$created = [ordered]@{}
$chatVerified = $false
$result = [ordered]@{
  startedAt = (Get-Date).ToString("o")
  finishedAt = $null
  mode = $Mode
  baseUrl = $BaseUrl
  startServer = $false
  reusedRunningServer = $false
  health = $false
  providerProbe = $null
  modelProbe = $null
  chatVerified = $false
  streamVerified = $false
  streamSummary = $null
  streamAbortVerified = $false
  streamAbortSummary = $null
  status = "running"
  failureCode = $null
  message = ""
  created = [ordered]@{
    providerId = $null
    modelId = $null
    agentId = $null
  }
}

try {
  if (($Mode -eq "full") -and $SkipChat) {
    Throw-VerifyError -Code "MODE_CONFLICT" -Message "Mode full requires chat verification. Remove -SkipChat."
  }
  if ($VerifyStream -and $SkipChat) {
    Throw-VerifyError -Code "MODE_CONFLICT" -Message "VerifyStream requires chat verification. Remove -SkipChat."
  }
  if ($VerifyStreamAbort -and $SkipChat) {
    Throw-VerifyError -Code "MODE_CONFLICT" -Message "VerifyStreamAbort requires chat verification. Remove -SkipChat."
  }
  if (($Mode -eq "full") -and [string]::IsNullOrWhiteSpace($ProviderKey)) {
    Throw-VerifyError -Code "PROVIDER_KEY_REQUIRED" -Message "Mode full requires ProviderKey (use GIRLAGENT_PROVIDER_KEY or -ProviderKey)."
  }

  $baseUrlSpecified = $PSBoundParameters.ContainsKey("BaseUrl") -or (-not [string]::IsNullOrWhiteSpace($env:GIRLAGENT_BASE_URL))
  $startServer = -not $NoStartServer
  $result.startServer = $startServer

  if ($startServer) {
    if (Test-HealthOnce -ProbeUrl $BaseUrl) {
      $canAuthAtBase = $false
      try {
        Invoke-Api -Method "GET" -Path "/api/bootstrap" | Out-Null
        $canAuthAtBase = $true
      } catch {
        $canAuthAtBase = $false
      }

      if ($canAuthAtBase) {
        Write-Step "detected running server, reusing existing instance"
        $startServer = $false
        $result.reusedRunningServer = $true
      } elseif ($baseUrlSpecified) {
        Throw-VerifyError -Code "AUTH_TOKEN_MISMATCH" -Message "healthy service found at $BaseUrl but token is invalid for this run"
      } else {
        $freePort = Get-FreeLocalPort
        $BaseUrl = "http://127.0.0.1:$freePort"
        Write-Step "existing service at default address uses another token, switched to $BaseUrl"
        $result.baseUrl = $BaseUrl
      }
    }
  }
  $result.startServer = $startServer

  if ($startServer) {
    $uri = [Uri]$BaseUrl
    if ((Test-PortInUse -Port $uri.Port) -and (-not (Test-HealthOnce -ProbeUrl $BaseUrl))) {
      if ($baseUrlSpecified) {
        Throw-VerifyError -Code "PORT_IN_USE" -Message "port $($uri.Port) is in use, and no healthy GirlAgent service was found at $BaseUrl"
      }
      $freePort = Get-FreeLocalPort
      $BaseUrl = "http://127.0.0.1:$freePort"
      $uri = [Uri]$BaseUrl
      Write-Step "default port busy, switched to $BaseUrl"
      $result.baseUrl = $BaseUrl
    }

    $bind = "{0}:{1}" -f $uri.Host, $uri.Port
    if (-not $env:GIRLAGENT_DB_URL) {
      $env:GIRLAGENT_DB_URL = "sqlite://girlagent-verify.db"
    }
    $env:GIRLAGENT_BIND = $bind
    $env:GIRLAGENT_TOKEN = $Token

    Write-Step "starting headless server at $BaseUrl"
    $serverProcess = Start-Process `
      -FilePath "cargo" `
      -ArgumentList @("run", "-p", "girlagent-web-server") `
      -WorkingDirectory $script:projectRoot `
      -PassThru `
      -WindowStyle Hidden

    Start-Sleep -Milliseconds 800
    if ($serverProcess.HasExited) {
      Throw-VerifyError -Code "SERVER_BOOT_EXIT" -Message "headless server process exited early (exit code: $($serverProcess.ExitCode)); try starting server manually and rerun with -NoStartServer"
    }
  }

  $healthAttempts = $(if ($startServer) { 240 } else { 6 })
  if (-not (Wait-Health -ProbeUrl $BaseUrl -ProcessRef $serverProcess -MaxAttempts $healthAttempts)) {
    Throw-VerifyError -Code "HEALTH_TIMEOUT" -Message "headless health check timed out at $BaseUrl"
  }
  $result.health = $true
  Write-Step "health check ok"

  $bootstrap = Invoke-Api -Method "GET" -Path "/api/bootstrap"
  Write-Step ("bootstrap ok: app={0}, api={1}" -f $bootstrap.appName, $bootstrap.apiVersion)

  $runtime = Invoke-Api -Method "GET" -Path "/api/runtime/status"
  Write-Step ("runtime counts: provider={0}, model={1}, agent={2}" -f $runtime.providerCount, $runtime.modelCount, $runtime.agentCount)

  $preset = $null
  if ($PresetId) {
    $preset = @($bootstrap.providerPresets | Where-Object { $_.id -eq $PresetId })[0]
    if (-not $preset) {
      Throw-VerifyError -Code "PRESET_NOT_FOUND" -Message "preset '$PresetId' not found in bootstrap provider presets"
    }
  } else {
    $preset = @($bootstrap.providerPresets)[0]
  }
  if (-not $preset) {
    Throw-VerifyError -Code "PRESET_EMPTY" -Message "bootstrap returned empty provider presets"
  }
  Write-Step ("using preset: {0}" -f $preset.id)

  $providerBody = @{
    displayName = "verify-provider-" + (Get-Date -Format "yyyyMMddHHmmss")
    providerKind = $preset.id
    apiBase = $preset.apiBase
    keys = @($(if ([string]::IsNullOrWhiteSpace($ProviderKey)) { "verify-dummy-key" } else { $ProviderKey }))
    enabled = $true
  }
  $provider = Invoke-Api -Method "POST" -Path "/api/providers" -Body $providerBody
  $created.providerId = $provider.id
  $result.created.providerId = $provider.id
  Write-Step ("provider created: {0}" -f $provider.id)

  $providerProbe = Invoke-Api -Method "POST" -Path "/api/runtime/provider-probe" -Body @{ providerId = $provider.id }
  $result.providerProbe = @{
    reachable = $providerProbe.reachable
    latencyMs = $providerProbe.latencyMs
    detail = $providerProbe.detail
  }
  Write-Step ("provider probe reachable={0}, detail={1}" -f $providerProbe.reachable, $providerProbe.detail)
  if ($RequireReachable -and (-not $providerProbe.reachable)) {
    Throw-VerifyError -Code "PROVIDER_PROBE_FAILED" -Message "provider probe failed: $($providerProbe.detail)"
  }

  $modelBody = @{
    name = "verify-model-" + (Get-Date -Format "HHmmss")
    providerRef = $provider.id
    customProvider = $null
    modelId = $ModelId
    category = "llm"
    capabilities = @{
      inputModes = @("text")
      outputModes = @("text")
      supportsFunctionCall = $false
      supportsStreaming = $true
      maxContextWindow = $null
    }
    params = @{
      temperature = 0.8
      maxTokens = 256
      topP = 1.0
      frequencyPenalty = 0.0
    }
    enabled = $true
  }
  $model = Invoke-Api -Method "POST" -Path "/api/models" -Body $modelBody
  $created.modelId = $model.id
  $result.created.modelId = $model.id
  Write-Step ("model created: {0}" -f $model.id)

  $modelProbe = Invoke-Api -Method "POST" -Path "/api/runtime/model-probe" -Body @{ modelRefId = $model.id }
  $result.modelProbe = @{
    reachable = $modelProbe.reachable
    latencyMs = $modelProbe.latencyMs
    detail = $modelProbe.detail
  }
  Write-Step ("model probe reachable={0}, detail={1}" -f $modelProbe.reachable, $modelProbe.detail)
  if ($RequireReachable -and (-not $modelProbe.reachable)) {
    Throw-VerifyError -Code "MODEL_PROBE_FAILED" -Message "model probe failed: $($modelProbe.detail)"
  }

  $agentBody = @{
    name = "verify-agent-" + (Get-Date -Format "HHmmss")
    persona = "Pragmatic assistant."
    speechRules = "Give concise answers."
    mode = "chat"
    componentSlot = @{
      asrModelId = $null
      ttsModelId = $null
      visionModelId = $null
    }
    toolSlot = @{
      plannerModelId = $null
      executorModelId = $null
    }
    replyModelId = $model.id
    decisionSlot = @{
      modelId = $null
      enabled = $false
    }
    paramSlots = @{
      component = @{
        asr = @{ temperature = $null; maxTokens = $null; topP = $null; frequencyPenalty = $null }
        tts = @{ temperature = $null; maxTokens = $null; topP = $null; frequencyPenalty = $null }
        vision = @{ temperature = $null; maxTokens = $null; topP = $null; frequencyPenalty = $null }
      }
      tool = @{
        planner = @{ temperature = $null; maxTokens = $null; topP = $null; frequencyPenalty = $null }
        executor = @{ temperature = $null; maxTokens = $null; topP = $null; frequencyPenalty = $null }
      }
      reply = @{ temperature = $null; maxTokens = $null; topP = $null; frequencyPenalty = $null }
      decision = @{ temperature = $null; maxTokens = $null; topP = $null; frequencyPenalty = $null }
    }
  }
  $agent = Invoke-Api -Method "POST" -Path "/api/agents" -Body $agentBody
  $created.agentId = $agent.id
  $result.created.agentId = $agent.id
  Write-Step ("agent created: {0}" -f $agent.id)

  $skipChatRun = $SkipChat.IsPresent
  if ((-not $skipChatRun) -and [string]::IsNullOrWhiteSpace($ProviderKey)) {
    $skipChatRun = $true
    Write-Step "chat step skipped: GIRLAGENT_PROVIDER_KEY is empty"
  }

  if (-not $skipChatRun) {
    $chatBody = @{
      agentId = $agent.id
      sessionId = $null
      userMessage = "Reply with: verification passed"
      history = @()
      temperature = $null
      maxTokens = $null
      topP = $null
      frequencyPenalty = $null
    }
    $chatResult = Invoke-Api -Method "POST" -Path "/api/chat" -Body $chatBody
    $chatVerified = $true
    $result.chatVerified = $true
    Write-Step ("chat ok: model={0}, replyLength={1}" -f $chatResult.modelId, $chatResult.message.Length)
  }

  if ($VerifyStream -and (-not $skipChatRun)) {
    $streamBody = @{
      agentId = $agent.id
      sessionId = $null
      userMessage = "Reply with: stream verification passed"
      history = @()
      temperature = $null
      maxTokens = $null
      topP = $null
      frequencyPenalty = $null
    }
    $streamResult = Invoke-ApiStreamChat -Path "/api/chat/stream" -Body $streamBody
    $streamDone = $streamResult.done
    if (-not $streamDone.message) {
      Throw-VerifyError -Code "STREAM_DONE_EMPTY" -Message "stream done payload missing message"
    }
    $result.streamVerified = $true
    $result.streamSummary = @{
      sessionId = $streamDone.sessionId
      modelId = $streamDone.modelId
      deltaLength = $streamResult.deltaText.Length
      messageLength = ([string]$streamDone.message).Length
    }
    Write-Step ("stream chat ok: model={0}, deltaLength={1}" -f $streamDone.modelId, $streamResult.deltaText.Length)
  }

  if ($VerifyStreamAbort -and (-not $skipChatRun)) {
    $streamAbortBody = @{
      agentId = $agent.id
      sessionId = $null
      userMessage = "Generate at least 400 ASCII characters and start with STREAM_ABORT_TEST:"
      history = @()
      temperature = $null
      maxTokens = $null
      topP = $null
      frequencyPenalty = $null
    }
    $streamAbortResult = Invoke-ApiStreamChat -Path "/api/chat/stream" -Body $streamAbortBody -AbortAfterFirstDelta
    if (-not $streamAbortResult.aborted) {
      Throw-VerifyError -Code "STREAM_ABORT_NOT_TRIGGERED" -Message "stream abort verification did not trigger abort"
    }
    if ($streamAbortResult.deltaText.Length -le 0) {
      Throw-VerifyError -Code "STREAM_ABORT_EMPTY_DELTA" -Message "stream abort verification received no delta before abort"
    }

    $followUpBody = @{
      agentId = $agent.id
      sessionId = $null
      userMessage = "Reply with: stream abort follow-up ok"
      history = @()
      temperature = $null
      maxTokens = $null
      topP = $null
      frequencyPenalty = $null
    }
    $followUpResult = Invoke-Api -Method "POST" -Path "/api/chat" -Body $followUpBody
    if (-not $followUpResult.message) {
      Throw-VerifyError -Code "STREAM_ABORT_FOLLOWUP_EMPTY" -Message "stream abort follow-up chat returned empty message"
    }

    $result.streamAbortVerified = $true
    $result.streamAbortSummary = @{
      deltaLength = $streamAbortResult.deltaText.Length
      followUpSessionId = $followUpResult.sessionId
      followUpModelId = $followUpResult.modelId
      followUpMessageLength = ([string]$followUpResult.message).Length
    }
    Write-Step ("stream abort ok: deltaLength={0}" -f $streamAbortResult.deltaText.Length)
  }

  $result.status = "passed"
  $result.message = "Headless verification passed."

  Write-Host ""
  Write-Host $result.message -ForegroundColor Green
  if ($chatVerified) {
    Write-Host "Chat verification: passed." -ForegroundColor Green
  } else {
    Write-Host "Chat verification: skipped." -ForegroundColor Yellow
  }
  if ($VerifyStream) {
    if ($result.streamVerified) {
      Write-Host "Stream verification: passed." -ForegroundColor Green
    } else {
      Write-Host "Stream verification: skipped." -ForegroundColor Yellow
    }
  }
  if ($VerifyStreamAbort) {
    if ($result.streamAbortVerified) {
      Write-Host "Stream abort verification: passed." -ForegroundColor Green
    } else {
      Write-Host "Stream abort verification: skipped." -ForegroundColor Yellow
    }
  }
} catch {
  $errorCode = "UNEXPECTED"
  if ($_.Exception -and $_.Exception.Data -and $_.Exception.Data.Contains("VerifyCode")) {
    $errorCode = [string]$_.Exception.Data["VerifyCode"]
  }
  $result.status = "failed"
  $result.failureCode = $errorCode
  $result.message = $_.Exception.Message
  Write-Host ""
  Write-Host ("Headless verification failed: [{0}] {1}" -f $errorCode, $_.Exception.Message) -ForegroundColor Red
  throw
} finally {
  $result.finishedAt = (Get-Date).ToString("o")
  $result.baseUrl = $BaseUrl
  $result.chatVerified = $chatVerified

  try {
    Write-ResultJson -payload $result
    if (-not [string]::IsNullOrWhiteSpace($OutputJson)) {
      Write-Step ("wrote result json: {0}" -f $OutputJson)
    }
  } catch {
    Write-Host ("[verify] failed to write result json: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
  }

  if ($PrintResultJson) {
    Write-Output ($result | ConvertTo-Json -Depth 30 -Compress)
  }

  if (-not $KeepArtifacts) {
    if ($created.agentId) {
      try { Invoke-Api -Method "DELETE" -Path "/api/agents/$($created.agentId)" | Out-Null } catch { }
    }
    if ($created.modelId) {
      try { Invoke-Api -Method "DELETE" -Path "/api/models/$($created.modelId)" | Out-Null } catch { }
    }
    if ($created.providerId) {
      try { Invoke-Api -Method "DELETE" -Path "/api/providers/$($created.providerId)" | Out-Null } catch { }
    }
  }

  if ($serverProcess -and (-not $KeepServer)) {
    try {
      if (-not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force
      }
    } catch {
      # no-op
    }
  }
}
