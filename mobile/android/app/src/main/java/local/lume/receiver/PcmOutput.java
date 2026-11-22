package local.lume.receiver;

import android.media.*;
import android.os.SystemClock;
import java.io.*;
import java.net.*;
import java.nio.*;
import java.util.Arrays;
import java.util.concurrent.*;

final class PcmOutput {
    static final int RATE=48000, BLOCK=RATE*4, FRAMES=960;
    static final class Source {
        final String url,cookie;
        volatile LocalAudio.Match local;volatile boolean localFailed;
        String channel="stereo";
        final ConcurrentMap<Integer,short[]> blocks=new ConcurrentHashMap<>();
        final ConcurrentMap<Integer,Boolean> fetching=new ConcurrentHashMap<>();
        Source(String url,String cookie){this.url=url;this.cookie=cookie;}
    }
    static final class Clock {
        final Source source;final boolean playing;final double start,volume,duration;
        Clock(Source s,boolean p,double start,double volume,double duration){source=s;playing=p;this.start=start;this.volume=volume;this.duration=duration;}
    }
    volatile Clock clock;
    volatile boolean closed;
    volatile int gaps,ahead,underflows;
    private final ExecutorService fetcher=Executors.newFixedThreadPool(2);
    private Thread writer;
    void update(String path,String cookie,boolean playing,double position,double duration,int delay,double volume,long sampleTime,LocalAudio.Match local,String channel){
        Clock prev=clock;
        Source s=prev!=null&&prev.source.url.equals(path)?prev.source:new Source(path,cookie);
        s.local=local;s.channel=channel;
        double start=sampleTime-position*1000+delay;
        clock=new Clock(s,playing,start,volume,duration);
        int first=Math.max(0,(int)Math.floor((position-delay/1000.0-.16)/4));
        for(Integer key:s.blocks.keySet())if(key<first-1||key>first+4)s.blocks.remove(key);
        int end=first;while(s.blocks.containsKey(end))end++;ahead=Math.max(0,(int)((Math.min(duration,end*4)-position)*1000));
        for(int n=first;n<=first+3 && n*4<duration;n++){
            final int index=n;
            if(s.blocks.containsKey(n)||s.fetching.putIfAbsent(n,true)!=null)continue;
            fetcher.execute(()->{
                HttpURLConnection h=null;
                try{
                    if(closed||clock.source!=s)return;
                    LocalAudio.Match match=s.local;
                    if(match!=null&&!s.localFailed){
                        try{
                        byte[] bytes=LocalAudio.block(match.path,s.channel,index,match.identity);
                        if(bytes.length>0&&bytes.length<=BLOCK*4&&bytes.length%4==0){
                            short[] pcm=new short[bytes.length/2];ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(pcm);s.blocks.put(index,pcm);return;
                        }
                        }catch(Exception ignored){}
                        s.localFailed=true;
                    }
                    h=(HttpURLConnection)new URL(s.url+"/"+index).openConnection();h.setRequestProperty("Cookie",s.cookie);
                    h.setConnectTimeout(1800);h.setReadTimeout(4000);h.setInstanceFollowRedirects(false);
                    try(InputStream in=h.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream(BLOCK*4)){
                        byte[] buf=new byte[16384];int len;
                        while((len=in.read(buf))!=-1 && out.size()<=BLOCK*4)out.write(buf,0,len);
                        byte[] bytes=out.toByteArray();
                        if(bytes.length<=BLOCK*4&&bytes.length%4==0){
                            short[] pcm=new short[bytes.length/2];ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(pcm);
                            s.blocks.put(index,pcm);
                        }
                    }
                }catch(Exception ignored){}finally{if(h!=null)h.disconnect();s.fetching.remove(index);}
            });
        }
        if(writer==null){writer=new Thread(this::render,"lume-output");writer.start();}
    }
    private void render(){
        android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO);
        int min=AudioTrack.getMinBufferSize(RATE,AudioFormat.CHANNEL_OUT_STEREO,AudioFormat.ENCODING_PCM_16BIT);
        AudioTrack track=new AudioTrack.Builder().setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
          .setAudioFormat(new AudioFormat.Builder().setSampleRate(RATE).setChannelMask(AudioFormat.CHANNEL_OUT_STEREO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
          .setBufferSizeInBytes(Math.max(min,FRAMES*4*5)).setTransferMode(AudioTrack.MODE_STREAM).build();
        short[] out=new short[FRAMES*2];AudioTimestamp ts=new AudioTimestamp();
        double cursor=Double.NaN,intercept=Double.NaN;long written=0,check=0;Source previous=null;boolean gap=false,heard=false;
        try{
            track.play();
            while(!closed){
                Clock c=clock;long now=SystemClock.elapsedRealtime();
                if(now>=check){
                    underflows=track.getUnderrunCount();
                    if(track.getTimestamp(ts) && ts.framePosition>0){
                        double measured=now+(ts.nanoTime-System.nanoTime())/1e6-ts.framePosition/48.0;
                        if(Double.isNaN(intercept)||Math.abs(measured-intercept)>80)intercept=measured;
                        else intercept+=0.25*(measured-intercept);
                    }
                    check=now+(Double.isNaN(intercept)?100:700);
                }
                double outputAt=Double.isNaN(intercept)?now+Math.max(0,written-Integer.toUnsignedLong(track.getPlaybackHeadPosition()))/48.0:intercept+written/48.0;
                if(Math.abs(outputAt-now)>500){intercept=Double.NaN;outputAt=now+60;}
                Arrays.fill(out,(short)0);
                if(c!=null && c.playing){
                    double desired=(outputAt-c.start)*48.0,err=desired-cursor;
                    if(previous!=c.source){heard=false;gap=false;}
                    if(previous!=c.source || Double.isNaN(cursor)||Math.abs(err)>7200){cursor=desired;err=0;}
                    double speed=1+Math.max(-.04,Math.min(.04,Math.abs(err)<32?0:err/24000.0));
                    boolean missing=false;short[] data=null;int key=-1;
                    for(int i=0;i<FRAMES;i++,cursor+=speed){
                        if(cursor<0 || cursor>=c.duration*RATE)continue;
                        int frame=(int)(cursor%BLOCK),n=(int)(cursor/BLOCK);
                        if(n!=key){key=n;data=c.source.blocks.get(n);}
                        if(data==null){missing=true;continue;}int at=frame*2;if(at+1>=data.length)continue;
                        heard=true;double frac=cursor-Math.floor(cursor);
                        int next=at+3<data.length?at+2:at;
                        for(int ch=0;ch<2;ch++)out[2*i+ch]=(short)((data[at+ch]+(data[next+ch]-data[at+ch])*frac)*c.volume);
                    }
                    if(missing&&heard&&!gap)gaps++;gap=missing;previous=c.source;
                }else{cursor=Double.NaN;gap=false;}
                int sent=0;
                while(!closed && sent<out.length){int n=track.write(out,sent,out.length-sent,AudioTrack.WRITE_BLOCKING);if(n<=0)return;sent+=n;}
                written+=sent/2;
            }
        }finally{track.release();}
    }
    void close(){closed=true;fetcher.shutdownNow();}
}

