export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];
export type Quat = [number, number, number, number];
export type Mat4 = Float32Array;
export interface AABB { min: Vec3; max: Vec3 }
export interface RayHit { distance: number; point: Vec3; normal: Vec3 }

export const EPSILON = 1e-6;
export const clamp = (v:number, lo=0, hi=1) => Math.max(lo, Math.min(hi, v));
export const lerp = (a:number,b:number,t:number) => a+(b-a)*t;
export const smoothstep = (a:number,b:number,x:number) => { const t=clamp((x-a)/(b-a)); return t*t*(3-2*t); };
export const damp = (current:number,target:number,lambda:number,dt:number) => lerp(current,target,1-Math.exp(-lambda*dt));

export const v3 = (x=0,y=0,z=0):Vec3 => [x,y,z];
export const add3=(a:Vec3,b:Vec3):Vec3=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
export const sub3=(a:Vec3,b:Vec3):Vec3=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
export const scale3=(a:Vec3,s:number):Vec3=>[a[0]*s,a[1]*s,a[2]*s];
export const mul3=(a:Vec3,b:Vec3):Vec3=>[a[0]*b[0],a[1]*b[1],a[2]*b[2]];
export const dot3=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const cross3=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const len3=(a:Vec3)=>Math.hypot(a[0],a[1],a[2]);
export const normalize3=(a:Vec3):Vec3=>{const l=len3(a);return l>EPSILON?scale3(a,1/l):[0,0,0]};
export const lerp3=(a:Vec3,b:Vec3,t:number):Vec3=>[lerp(a[0],b[0],t),lerp(a[1],b[1],t),lerp(a[2],b[2],t)];
export const reflect3=(i:Vec3,n:Vec3):Vec3=>sub3(i,scale3(n,2*dot3(i,n)));

export const identity4=():Mat4=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
export function multiply4(a:Mat4,b:Mat4):Mat4 { const o=new Float32Array(16); for(let c=0;c<4;c++)for(let r=0;r<4;r++)o[c*4+r]=a[r]*b[c*4]+a[4+r]*b[c*4+1]+a[8+r]*b[c*4+2]+a[12+r]*b[c*4+3]; return o; }
export const perspective=(fovy:number,aspect:number,near:number,far:number):Mat4=>{const f=1/Math.tan(fovy/2),nf=1/(near-far);return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)*nf,-1,0,0,2*far*near*nf,0]);};
export const orthographic=(l:number,r:number,b:number,t:number,n:number,f:number):Mat4=>new Float32Array([2/(r-l),0,0,0,0,2/(t-b),0,0,0,0,-2/(f-n),0,-(r+l)/(r-l),-(t+b)/(t-b),-(f+n)/(f-n),1]);
export function lookAt(eye:Vec3,target:Vec3,up:Vec3):Mat4 { const z=normalize3(sub3(eye,target)),x=normalize3(cross3(up,z)),y=cross3(z,x); return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot3(x,eye),-dot3(y,eye),-dot3(z,eye),1]); }
export const translation4=(v:Vec3):Mat4=>{const m=identity4();m[12]=v[0];m[13]=v[1];m[14]=v[2];return m};
export const scaling4=(v:Vec3):Mat4=>new Float32Array([v[0],0,0,0,0,v[1],0,0,0,0,v[2],0,0,0,0,1]);
export const rotationX4=(a:number):Mat4=>{const c=Math.cos(a),s=Math.sin(a);return new Float32Array([1,0,0,0,0,c,s,0,0,-s,c,0,0,0,0,1])};
export const rotationY4=(a:number):Mat4=>{const c=Math.cos(a),s=Math.sin(a);return new Float32Array([c,0,-s,0,0,1,0,0,s,0,c,0,0,0,0,1])};
export const rotationZ4=(a:number):Mat4=>{const c=Math.cos(a),s=Math.sin(a);return new Float32Array([c,s,0,0,-s,c,0,0,0,0,1,0,0,0,0,1])};
export const translate=(m:Mat4,v:Vec3)=>multiply4(m,translation4(v));
export const scale=(m:Mat4,v:Vec3)=>multiply4(m,scaling4(v));
export const rotateX=(m:Mat4,a:number)=>multiply4(m,rotationX4(a));
export const rotateY=(m:Mat4,a:number)=>multiply4(m,rotationY4(a));
export const rotateZ=(m:Mat4,a:number)=>multiply4(m,rotationZ4(a));
export const transpose4=(m:Mat4):Mat4=>new Float32Array([m[0],m[4],m[8],m[12],m[1],m[5],m[9],m[13],m[2],m[6],m[10],m[14],m[3],m[7],m[11],m[15]]);
export function invert4(a:Mat4):Mat4|null { const o=new Float32Array(16); const b00=a[0]*a[5]-a[1]*a[4],b01=a[0]*a[6]-a[2]*a[4],b02=a[0]*a[7]-a[3]*a[4],b03=a[1]*a[6]-a[2]*a[5],b04=a[1]*a[7]-a[3]*a[5],b05=a[2]*a[7]-a[3]*a[6],b06=a[8]*a[13]-a[9]*a[12],b07=a[8]*a[14]-a[10]*a[12],b08=a[8]*a[15]-a[11]*a[12],b09=a[9]*a[14]-a[10]*a[13],b10=a[9]*a[15]-a[11]*a[13],b11=a[10]*a[15]-a[11]*a[14]; let d=b00*b11-b01*b10+b02*b09+b03*b08-b04*b07+b05*b06;if(Math.abs(d)<EPSILON)return null;d=1/d;o[0]=(a[5]*b11-a[6]*b10+a[7]*b09)*d;o[1]=(-a[1]*b11+a[2]*b10-a[3]*b09)*d;o[2]=(a[13]*b05-a[14]*b04+a[15]*b03)*d;o[3]=(-a[9]*b05+a[10]*b04-a[11]*b03)*d;o[4]=(-a[4]*b11+a[6]*b08-a[7]*b07)*d;o[5]=(a[0]*b11-a[2]*b08+a[3]*b07)*d;o[6]=(-a[12]*b05+a[14]*b02-a[15]*b01)*d;o[7]=(a[8]*b05-a[10]*b02+a[11]*b01)*d;o[8]=(a[4]*b10-a[5]*b08+a[7]*b06)*d;o[9]=(-a[0]*b10+a[1]*b08-a[3]*b06)*d;o[10]=(a[12]*b04-a[13]*b02+a[15]*b00)*d;o[11]=(-a[8]*b04+a[9]*b02-a[11]*b00)*d;o[12]=(-a[4]*b09+a[5]*b07-a[6]*b06)*d;o[13]=(a[0]*b09-a[1]*b07+a[2]*b06)*d;o[14]=(-a[12]*b03+a[13]*b01-a[14]*b00)*d;o[15]=(a[8]*b03-a[9]*b01+a[10]*b00)*d;return o; }
export const transformPoint=(m:Mat4,v:Vec3):Vec3=>{const w=m[3]*v[0]+m[7]*v[1]+m[11]*v[2]+m[15]||1;return[(m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12])/w,(m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13])/w,(m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14])/w]};

export const quatIdentity=():Quat=>[0,0,0,1];
export const quatFromAxisAngle=(axis:Vec3,a:number):Quat=>{const n=normalize3(axis),s=Math.sin(a/2);return[n[0]*s,n[1]*s,n[2]*s,Math.cos(a/2)]};
export const normalizeQuat=(q:Quat):Quat=>{const l=Math.hypot(...q);return l>EPSILON?[q[0]/l,q[1]/l,q[2]/l,q[3]/l]:quatIdentity()};
export function slerpQuat(a:Quat,b:Quat,t:number):Quat { let d=a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3],bb:Quat=[...b];if(d<0){d=-d;bb=[-b[0],-b[1],-b[2],-b[3]]}if(d>.9995)return normalizeQuat([lerp(a[0],bb[0],t),lerp(a[1],bb[1],t),lerp(a[2],bb[2],t),lerp(a[3],bb[3],t)]);const th=Math.acos(clamp(d,-1,1)),s=Math.sin(th);return scaleQuatPair(a,bb,Math.sin((1-t)*th)/s,Math.sin(t*th)/s); }
const scaleQuatPair=(a:Quat,b:Quat,x:number,y:number):Quat=>[a[0]*x+b[0]*y,a[1]*x+b[1]*y,a[2]*x+b[2]*y,a[3]*x+b[3]*y];
export const quatToMat4=(q0:Quat):Mat4=>{const q=normalizeQuat(q0),[x,y,z,w]=q,x2=x+x,y2=y+y,z2=z+z;return new Float32Array([1-y*y2-z*z2,x*y2+z*w*2,x*z2-y*w*2,0,x*y2-z*w*2,1-x*x2-z*z2,y*z2+x*w*2,0,x*z2+y*w*2,y*z2-x*w*2,1-x*x2-y*y2,0,0,0,0,1])};

export const emptyAABB=():AABB=>({min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]});
export const expandAABB=(b:AABB,p:Vec3):AABB=>({min:[Math.min(b.min[0],p[0]),Math.min(b.min[1],p[1]),Math.min(b.min[2],p[2])],max:[Math.max(b.max[0],p[0]),Math.max(b.max[1],p[1]),Math.max(b.max[2],p[2])]});
export const intersectsAABB=(a:AABB,b:AABB)=>a.min[0]<=b.max[0]&&a.max[0]>=b.min[0]&&a.min[1]<=b.max[1]&&a.max[1]>=b.min[1]&&a.min[2]<=b.max[2]&&a.max[2]>=b.min[2];
export function rayAABB(origin:Vec3,dir:Vec3,box:AABB):RayHit|null { let t0=-Infinity,t1=Infinity,axis=0,sign=0;for(let i=0;i<3;i++){if(Math.abs(dir[i])<EPSILON){if(origin[i]<box.min[i]||origin[i]>box.max[i])return null;continue}let a=(box.min[i]-origin[i])/dir[i],b=(box.max[i]-origin[i])/dir[i],s=-Math.sign(dir[i]);if(a>b){[a,b]=[b,a];s=-s}if(a>t0){t0=a;axis=i;sign=s}t1=Math.min(t1,b);if(t0>t1)return null}const d=t0>=0?t0:t1;if(d<0)return null;const n:Vec3=[0,0,0];n[axis]=sign;return{distance:d,point:add3(origin,scale3(dir,d)),normal:n}; }
export function rayTriangle(o:Vec3,d:Vec3,a:Vec3,b:Vec3,c:Vec3):RayHit|null {const e1=sub3(b,a),e2=sub3(c,a),p=cross3(d,e2),det=dot3(e1,p);if(Math.abs(det)<EPSILON)return null;const inv=1/det,t=sub3(o,a),u=dot3(t,p)*inv;if(u<0||u>1)return null;const q=cross3(t,e1),v=dot3(d,q)*inv;if(v<0||u+v>1)return null;const distance=dot3(e2,q)*inv;if(distance<0)return null;return{distance,point:add3(o,scale3(d,distance)),normal:normalize3(cross3(e1,e2))};}
