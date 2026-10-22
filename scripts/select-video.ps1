Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$picker = [System.Windows.Forms.OpenFileDialog]::new()
$picker.Title = 'ClipNest - Select a video'
$picker.Filter = 'Video files|*.mp4;*.mov;*.webm;*.mkv;*.m4v;*.avi;*.mpg;*.mpeg;*.mts|All files|*.*'
$picker.CheckFileExists = $true
$picker.Multiselect = $false
$owner = [System.Windows.Forms.Form]::new()
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.Size = [System.Drawing.Size]::new(1, 1)
$owner.StartPosition = 'CenterScreen'
$owner.Opacity = 0
try {
    $owner.Show()
    $owner.Activate()
    if ($picker.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
        @{ path = $picker.FileName; cancelled = $false } | ConvertTo-Json -Compress
    } else {
        @{ cancelled = $true } | ConvertTo-Json -Compress
    }
} finally {
    $picker.Dispose()
    $owner.Dispose()
}
