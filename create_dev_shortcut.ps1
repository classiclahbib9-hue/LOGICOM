$workingDir = "C:\Users\PC\software\LOGICOM"
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = [IO.Path]::Combine($desktop, "LOGICOM (Dev Mode).lnk")

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
# We point to cmd so it runs npm start in the project folder
$shortcut.TargetPath = "C:\Windows\System32\cmd.exe"
$shortcut.Arguments = "/k npm start"
$shortcut.WorkingDirectory = $workingDir
$shortcut.IconLocation = "C:\Users\PC\software\LOGICOM\logo.png,0"
$shortcut.Save()
Write-Host "Dev Mode shortcut created at: $shortcutPath"
