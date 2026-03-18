Option Explicit

Dim oShell
Set oShell = CreateObject("WScript.Shell")

' Kill any existing node.exe processes
On Error Resume Next
oShell.Run "taskkill /F /IM node.exe", 0, True
On Error GoTo 0

' Wait briefly for processes to die
WScript.Sleep 1000

' Get the directory where this script lives
Dim sScriptDir
sScriptDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))

' Start node server.js from the api\ subdirectory, completely hidden
Dim sCmd
sCmd = "cmd /c ""cd /d """ & sScriptDir & "api"" && node server.js"""
oShell.Run sCmd, 0, False

' Wait 2 seconds then confirm
WScript.Sleep 2000
MsgBox "API PMD iniciada correctamente en puerto 3001", vbInformation, "PMD Platform"

Set oShell = Nothing
