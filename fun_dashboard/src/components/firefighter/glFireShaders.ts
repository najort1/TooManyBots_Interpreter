export const FIRE_MAX_POINT_LIGHTS = 12;

export const fireVertexShader = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
layout(location=3) in vec4 aColor;
uniform mat4 uModel, uView, uProjection;
uniform mat3 uNormalMatrix;
out vec3 vWorldPos; out vec3 vNormal; out vec2 vUV; out vec4 vColor;
void main(){ vec4 w=uModel*vec4(aPosition,1.0); vWorldPos=w.xyz; vNormal=normalize(uNormalMatrix*aNormal); vUV=aUV; vColor=aColor; gl_Position=uProjection*uView*w; }
`;

export const fireFragmentShader = `#version 300 es
precision highp float;
#define MAX_LIGHTS 12
struct PointLight { vec3 position; vec3 color; float intensity; float radius; float flicker; };
uniform PointLight uLights[MAX_LIGHTS]; uniform int uLightCount;
uniform vec3 uCameraPos, uSunDirection, uSunColor, uAmbientColor;
uniform vec3 uAlbedo, uEmissive; uniform float uRoughness, uHeat, uTime, uFogDensity, uSmokeDensity;
uniform vec3 uFogColor; uniform bool uFaceNormals;
in vec3 vWorldPos; in vec3 vNormal; in vec2 vUV; in vec4 vColor; out vec4 fragColor;
float hash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1)),f.x),f.y),f.z);}
void main(){
 vec3 N=uFaceNormals?normalize(cross(dFdx(vWorldPos),dFdy(vWorldPos))):normalize(vNormal); if(!gl_FrontFacing)N=-N;
 vec3 V=normalize(uCameraPos-vWorldPos); vec3 base=uAlbedo*vColor.rgb; vec3 lit=uAmbientColor*base;
 vec3 Ls=normalize(-uSunDirection); float ndl=max(dot(N,Ls),0.0); vec3 H=normalize(Ls+V);
 lit+=base*uSunColor*ndl+uSunColor*pow(max(dot(N,H),0.0),mix(96.0,8.0,uRoughness))*.25;
 for(int i=0;i<MAX_LIGHTS;i++){if(i>=uLightCount)break; vec3 delta=uLights[i].position-vWorldPos;float dist=length(delta);vec3 L=delta/max(dist,.001);float fall=pow(clamp(1.0-dist/uLights[i].radius,0.0,1.0),2.0);float flick=mix(1.0,.72+noise(vec3(uTime*9.0,float(i)*7.1,vWorldPos.y*.2))*.5,uLights[i].flicker);float siren=1.0+.25*sin(uTime*11.0+float(i)*3.14159);float diff=max(dot(N,L),0.0);float spec=pow(max(dot(N,normalize(L+V)),0.0),mix(96.0,8.0,uRoughness));lit+=(base*diff+spec*.4)*uLights[i].color*uLights[i].intensity*fall*flick*siren;}
 float ember=noise(vWorldPos*3.0+vec3(0,uTime*.4,0));vec3 heat=uEmissive*uHeat*(.35+1.8*smoothstep(.48,.9,ember));lit+=heat;
 float dist=length(uCameraPos-vWorldPos);float smoke=noise(vWorldPos*.09+vec3(0,-uTime*.025,0));float fog=1.0-exp(-dist*uFogDensity*(1.0+uSmokeDensity*smoke)*max(dist,1.0));
 float shimmer=noise(vec3(vWorldPos.xz*.7,uTime*2.0));lit*=.96+.08*shimmer*uHeat;fragColor=vec4(mix(lit,uFogColor,clamp(fog,0.0,.94)),vColor.a);
}`;

export const particleVertexShader = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition; layout(location=1) in vec3 aVelocity; layout(location=2) in vec4 aColor;
layout(location=3) in float aSize; layout(location=4) in float aBirth; layout(location=5) in float aLife; layout(location=6) in float aRotation;
uniform mat4 uView,uProjection; uniform vec3 uEmitter,uAcceleration,uWind; uniform float uTime; uniform int uParticleType;
out vec4 vColor; out float vAge; out float vRotation; flat out int vType;
void main(){float age=clamp((uTime-aBirth)/max(aLife,.001),0.0,1.0);float t=max(uTime-aBirth,0.0);vec3 p=uEmitter+aPosition+aVelocity*t+.5*uAcceleration*t*t+uWind*t*mix(.15,1.0,age);if(uParticleType==1)p+=vec3(sin(t*19.0)*.03,0.,cos(t*17.0)*.03);if(uParticleType>=3)p.y+=age*age*2.0;gl_Position=uProjection*uView*vec4(p,1.0);gl_PointSize=aSize*(1.0+age*mix(.15,2.5,step(3.0,float(uParticleType))))/max(.1,gl_Position.w);vColor=aColor;vAge=age;vRotation=aRotation+t*(uParticleType==2?8.0:1.5);vType=uParticleType;}`;

export const particleFragmentShader = `#version 300 es
precision highp float;
in vec4 vColor; in float vAge; in float vRotation; flat in int vType; out vec4 fragColor;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){vec2 q=gl_PointCoord-.5;float c=cos(vRotation),s=sin(vRotation);q=mat2(c,-s,s,c)*q;float r=length(q)*2.0;float soft=1.0-smoothstep(.45,1.0,r);float n=hash(floor(q*18.0)+float(vType));vec3 col=vColor.rgb;float alpha=soft;
 if(vType==0){col=mix(vec3(.28,.62,1.),vec3(.85,.96,1.),1.-r);alpha*=pow(1.-vAge,.45);} // water
 else if(vType==1){col=mix(vec3(.78,.9,.72),vec3(1.),n);alpha*=smoothstep(1.,.15,vAge)*(.7+.3*n);} // foam
 else if(vType==2){col=mix(vec3(1.,.14,.01),vec3(1.,.92,.18),1.-r);alpha*=pow(1.-vAge,2.);} // sparks
 else if(vType==3){col=mix(vec3(.45,.015,.002),vec3(1.,.65,.03),clamp(1.3-r-vAge*.4,0.,1.));alpha*=smoothstep(1.,.05,vAge);} // flame
 else {col=mix(vec3(.06),vec3(.32),n);alpha*=soft*pow(1.-vAge,.6)*(.45+.55*n);} // smoke
 if(alpha<.015)discard;fragColor=vec4(col,alpha*vColor.a);}`;
