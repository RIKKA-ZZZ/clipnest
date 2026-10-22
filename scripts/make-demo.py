"""Create a small original animated landscape and synthesized audio locally."""
from PIL import Image, ImageDraw, ImageFilter
import math, pathlib, subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
W, H = 960, 540
im = Image.new('RGB',(W,H))
d = ImageDraw.Draw(im)
def blend(a,b,t): return tuple(round(x+(y-x)*t) for x,y in zip(a,b))
for y in range(H):
    if y < 320: color=blend((43,67,80),(219,158,116),(y/320)**1.8)
    else: color=blend((134,123,101),(36,64,65),((y-320)/220)**.6)
    d.line((0,y,W,y),fill=color)
glow=Image.new('RGBA',(W,H));gd=ImageDraw.Draw(glow)
gd.ellipse((490,115,710,335),fill=(255,216,147,50));glow=glow.filter(ImageFilter.GaussianBlur(48))
im=Image.alpha_composite(im.convert('RGBA'),glow);d=ImageDraw.Draw(im)
d.ellipse((555,181,645,271),fill=(255,222,167))
d.polygon([(0,310),(0,267),(65,280),(116,255),(182,286),(242,269),(313,303),(390,310)],fill=(79,91,89))
d.polygon([(620,320),(700,295),(745,298),(790,267),(840,284),(906,258),(960,279),(960,322)],fill=(83,91,86))
for y in range(322,530,5):
    t=(y-322)/208
    for j in range(5):
        x=(y*19+j*171)%960
        length=10+int(t*42)
        c=(124+int(t*2),143-int(t*15),125-int(t*9))
        d.line((x,y,x+length,y),fill=c,width=1)
    spread=8+(y-322)*.28
    d.line((600-spread,y,600+spread,y),fill=(174-int(t*35),154-int(t*20),113),width=2)
# Foreground sailboat.
d.line((382,317,382,419),fill=(39,55,52),width=3)
d.polygon([(378,328),(378,407),(328,407)],fill=(230,218,185))
d.polygon([(387,343),(387,407),(425,407)],fill=(188,180,150))
d.polygon([(322,418),(431,418),(417,431),(342,430)],fill=(37,54,52))
d.line((309,439,446,439),fill=(93,117,105),width=2)
image_path=ROOT/'scripts'/'demo-source.png';im.convert('RGB').save(image_path)
command=['ffmpeg','-y','-hide_banner','-loglevel','error','-loop','1','-i',str(image_path),'-f','lavfi','-i','sine=frequency=330:sample_rate=44100:duration=8','-vf','scale=1056:594,crop=960:540:x=48+12*sin(t/4):y=27+5*cos(t/3),format=yuv420p','-t','8','-r','24','-c:v','libx264','-preset','fast','-crf','25','-c:a','aac','-af','volume=0.12,afade=t=in:d=0.5,afade=t=out:st=7:d=1','-movflags','+faststart',str(ROOT/'dist'/'demo.mp4')]
subprocess.run(command,check=True)
print(f'Demo created: {(ROOT/"dist"/"demo.mp4").stat().st_size:,} bytes')
