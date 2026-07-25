$body = '{"url":"https://www.stepfun.com/","options":{"aspectRatio":"16:9"}}'
$resp = Invoke-RestMethod -Uri "http://localhost:8787/render" -Method POST -Body $body -ContentType "application/json"
$resp | ConvertTo-Json -Depth 5
Write-Host "---JOBID---"
Write-Host $resp.jobId
