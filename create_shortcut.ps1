$targetPath = "C:\Users\PC\software\LOGICOM\dist\win-unpacked\LOGICOM.exe"
$workingDir = "C:\Users\PC\software\LOGICOM\dist\win-unpacked"
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = [IO.Path]::Combine($desktop, "LOGICOM.lnk")
$iconPath = "C:\Users\PC\software\LOGICOM\logo.png"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $targetPath
$shortcut.WorkingDirectory = $workingDir
if (Test-Path $iconPath) {
    # Using png for icon might not work without .ico file, 
    # but Windows sometimes handles it or just use default exe icon
    # $shortcut.IconLocation = "$iconPath,0"
}
$shortcut.Save()
Write-Host "Shortcut created at: $shortcutPath"
