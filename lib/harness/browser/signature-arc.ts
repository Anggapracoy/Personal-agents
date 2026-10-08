// Adapted from Cua's dc-signature-arc, cuaBezier, makePath and bumpProfile.
// Source: trycua/cua, revision 73387960d56a99dd2f607cef9b2bdae57e373217.
// MIT notice: docs/licenses/cua-cursor-motion.txt.
// Self-contained because the controller evaluates it in an isolated world.
export const SIGNATURE_ARC_EXPRESSION = String.raw`((a, b, width = 24) => {
  const dx=b.x-a.x, dy=b.y-a.y, distance=Math.hypot(dx,dy), length=Math.max(1,distance);
  const side=dx>=0 ? -1 : 1, px=-dy/length, py=dx/length;
  const bend=length*.16*side, flow=(.15+1)/2;
  const c1={x:a.x+dx*.3+px*bend*(1-.5*flow),y:a.y+dy*.3+py*bend*(1-.5*flow)};
  const c2={x:b.x-dx*.3+px*bend*(1-.5*(1-flow)),y:b.y-dy*.3+py*bend*(1-.5*(1-flow))};
  const at=u=>{const v=1-u;return {x:v*v*v*a.x+3*v*v*u*c1.x+3*v*u*u*c2.x+u*u*u*b.x,y:v*v*v*a.y+3*v*v*u*c1.y+3*v*u*u*c2.y+u*u*u*b.y};};
  const points=[at(0)], sums=[0];
  for(let i=1;i<=256;i++){const p=at(i/256),prev=points[i-1];points.push(p);sums.push(sums[i-1]+Math.hypot(p.x-prev.x,p.y-prev.y));}
  const total=sums[256], end=at(.999), endLength=Math.hypot(b.x-end.x,b.y-end.y)||1;
  const over=Math.min(.018,8/length), alpha=8.2, beta=1.8;
  const peak=Math.pow(alpha/10,alpha)*Math.pow(beta/10,beta);
  return {
    duration:Math.max(300,Math.min(1000,150+120*Math.log2(distance/Math.max(4,width)+1)))*1.1,
    at(t){
      if(t<=0)return a;if(t>=1)return b;
      const fraction=t*t*t*(10-15*t+6*t*t)+over*Math.pow(t,alpha)*Math.pow(1-t,beta)/peak;
      if(fraction>1)return {x:b.x+(b.x-end.x)/endLength*(fraction-1)*total,y:b.y+(b.y-end.y)/endLength*(fraction-1)*total};
      const target=fraction*total;let lo=0,hi=256;
      while(hi-lo>1){const mid=(lo+hi)>>1;if(sums[mid]<target)lo=mid;else hi=mid;}
      return at((lo+(target-sums[lo])/(sums[hi]-sums[lo]||1))/256);
    }
  };
})`;
