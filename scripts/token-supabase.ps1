# Lee el token de la CLI de Supabase desde el Administrador de credenciales
# de Windows (entrada "Supabase CLI:supabase") y lo deja en
# $env:SUPABASE_ACCESS_TOKEN para scripts/aplicar-sql.mjs.
$sig = @"
[DllImport("Advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
public static extern bool CredRead(string target, uint type, uint flags, out IntPtr credentialPtr);
[DllImport("Advapi32.dll")]
public static extern void CredFree(IntPtr cred);
"@
if (-not ("Win32.CredMan" -as [type])) {
  Add-Type -MemberDefinition $sig -Name CredMan -Namespace Win32 | Out-Null
}
$ptr = [IntPtr]::Zero
if (-not [Win32.CredMan]::CredRead("Supabase CLI:supabase", 1, 0, [ref]$ptr)) {
  throw "No se encontró la credencial 'Supabase CLI:supabase'. Inicia sesión con 'npx supabase login'."
}
try {
  $blobSize = [System.Runtime.InteropServices.Marshal]::ReadInt32($ptr, 32)
  $blobPtr  = [System.Runtime.InteropServices.Marshal]::ReadIntPtr($ptr, 40)
  $bytes    = New-Object byte[] $blobSize
  [System.Runtime.InteropServices.Marshal]::Copy($blobPtr, $bytes, 0, $blobSize)
  $env:SUPABASE_ACCESS_TOKEN = [System.Text.Encoding]::UTF8.GetString($bytes)
} finally {
  [Win32.CredMan]::CredFree($ptr)
}
Write-Host "SUPABASE_ACCESS_TOKEN cargado ($($env:SUPABASE_ACCESS_TOKEN.Length) caracteres)."
