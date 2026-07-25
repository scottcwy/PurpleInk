$jobId = "b7b35615-ce68-4101-acf0-12f956c24819"
$url = "http://localhost:8787/jobs/$jobId"
$startTime = Get-Date
$maxMinutes = 10

while ($true) {
    $elapsed = ((Get-Date) - $startTime).TotalMinutes
    if ($elapsed -gt $maxMinutes) {
        Write-Host "TIMEOUT after $maxMinutes minutes"
        break
    }
    try {
        $resp = Invoke-RestMethod -Uri $url -Method GET
        $status = $resp.status
        $ts = Get-Date -Format "HH:mm:ss"
        Write-Host "[$ts] status=$status elapsed=$([math]::Round($elapsed,1))min"
        if ($status -eq "done" -or $status -eq "failed") {
            $resp | ConvertTo-Json -Depth 10
            break
        }
    } catch {
        Write-Host "[$ts] poll error: $_"
    }
    Start-Sleep -Seconds 15
}
