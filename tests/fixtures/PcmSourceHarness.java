package local.lume.receiver;
import android.os.ParcelFileDescriptor;
import org.json.JSONObject;
import java.io.File;
import java.nio.*;
import java.security.MessageDigest;
import java.lang.reflect.Field;
public class PcmSourceHarness {
 public static void main(String[] args)throws Exception {
  String path=args[0],identity=args[1],url=args[2],cookie=args[3];
  LocalAudio.Match match=new LocalAudio.Match(ParcelFileDescriptor.open(new File(path),ParcelFileDescriptor.MODE_READ_ONLY),new JSONObject(),identity);
  // Prime the same native fingerprint cache used by the production resolver.
  android.system.Os.lseek(match.fd.getFileDescriptor(),123,android.system.OsConstants.SEEK_SET);
  LocalAudio.block(match.path,"stereo",-1);
  if(android.system.Os.lseek(match.fd.getFileDescriptor(),0,android.system.OsConstants.SEEK_CUR)!=123)throw new AssertionError("Hash changed descriptor cursor");
  PcmOutput output=new PcmOutput();Field writer=PcmOutput.class.getDeclaredField("writer");writer.setAccessible(true);writer.set(output,new Thread());
  try{
   output.update(url,cookie,true,0,20,0,1,android.os.SystemClock.elapsedRealtime(),match,"stereo");
   long until=System.currentTimeMillis()+10000;while(!output.clock.source.blocks.containsKey(0)&&System.currentTimeMillis()<until)Thread.sleep(20);
   short[] pcm=output.clock.source.blocks.get(0);if(pcm==null)throw new AssertionError("No PCM block");
   ByteBuffer bytes=ByteBuffer.allocate(pcm.length*2).order(ByteOrder.LITTLE_ENDIAN);bytes.asShortBuffer().put(pcm);
   byte[] digest=MessageDigest.getInstance("SHA-256").digest(bytes.array());StringBuilder hex=new StringBuilder();for(byte b:digest)hex.append(String.format("%02x",b&255));
   System.out.println(new JSONObject().put("size",bytes.capacity()).put("sha256",hex.toString()).put("localFailed",output.clock.source.localFailed));
  }finally{output.close();match.close();}
  System.exit(0);
 }
}
