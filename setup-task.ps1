# GCC Job Agent - Windows Scheduled Task Setup
# Run this script as Administrator

$projectPath = $PSScriptRoot
$nodePath = (Get-Command node).Source

Write-Host "Project path: $projectPath"
Write-Host "Node path:    $nodePath"

$action = New-ScheduledTaskAction `
    -Execute $nodePath `
    -Argument 'index.js' `
    -WorkingDirectory $projectPath

$trigger = New-ScheduledTaskTrigger -Daily -At '08:10AM'

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask `
    -TaskName 'GCC Job Search Agent' `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description 'Daily GCC job search agent for Dubai and GCC roles' `
    -Force

$task = Get-ScheduledTask -TaskName 'GCC Job Search Agent'
Write-Host "Task status: " $task.State

Write-Host ""
Write-Host "=== MANAGEMENT COMMANDS ==="
Write-Host "Run now:    Start-ScheduledTask -TaskName 'GCC Job Search Agent'"
Write-Host "Check:      Get-ScheduledTask -TaskName 'GCC Job Search Agent'"
Write-Host "Disable:    Disable-ScheduledTask -TaskName 'GCC Job Search Agent'"
Write-Host "Remove:     Unregister-ScheduledTask -TaskName 'GCC Job Search Agent'"
Write-Host ""
Write-Host "=== Setup complete! Agent will run daily at 8:10 AM ==="
