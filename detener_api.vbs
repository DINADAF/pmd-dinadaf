Option Explicit

Dim oShell
Set oShell = CreateObject("WScript.Shell")

' Kill node.exe processes
On Error Resume Next
oShell.Run "taskkill /F /IM node.exe", 0, True
On Error GoTo 0

MsgBox "API PMD detenida", vbInformation, "PMD Platform"

Set oShell = Nothing
