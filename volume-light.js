import * as THREE from './vendor/three.module.js';

// Atmospheric scattering inside a finite circular cone. A small depth prepass
// stops each view ray at the nearest book, so haze cannot show through pages.
export function createVolumeLight(renderer,scene,camera,light){
  const depth=new THREE.DepthTexture(1,1,THREE.UnsignedIntType);
  depth.minFilter=depth.magFilter=THREE.NearestFilter;
  const target=new THREE.WebGLRenderTarget(1,1,{minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,depthBuffer:true,stencilBuffer:false});
  target.depthTexture=depth;
  const depthMaterial=new THREE.MeshDepthMaterial({depthPacking:THREE.BasicDepthPacking});
  depthMaterial.toneMapped=false;
  const uniforms={
    sceneDepth:{value:depth},inverseProjection:{value:camera.projectionMatrixInverse},cameraWorld:{value:camera.matrixWorld},
    coneOrigin:{value:light.position},coneAxis:{value:new THREE.Vector3(0,-1,0)},coneLength:{value:10},coneTangent:{value:.25},
    lightColor:{value:light.color},lightShadow:{value:null},lightMatrix:{value:light.shadow.matrix},shadowReady:{value:0},samples:{value:24},strength:{value:.04}
  };
  const material=new THREE.ShaderMaterial({uniforms,transparent:true,depthTest:false,depthWrite:false,blending:THREE.CustomBlending,blendEquation:THREE.AddEquation,blendSrc:THREE.SrcAlphaFactor,blendDst:THREE.OneFactor,blendSrcAlpha:THREE.OneFactor,blendDstAlpha:THREE.OneMinusSrcAlphaFactor,toneMapped:false,
    vertexShader:`varying vec2 vUv;
      void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`,
    fragmentShader:`
      #include <packing>
      varying vec2 vUv;
      uniform sampler2D sceneDepth;
      uniform sampler2D lightShadow;
      uniform mat4 inverseProjection,cameraWorld,lightMatrix;
      uniform vec3 coneOrigin,coneAxis,lightColor;
      uniform float coneLength,coneTangent,shadowReady,samples,strength;
      vec3 worldAt(float z){vec4 p=cameraWorld*inverseProjection*vec4(vUv*2.0-1.0,z,1.0);return p.xyz/p.w;}
      void main(){
        vec3 start=worldAt(-1.0),farPoint=worldAt(1.0),ray=normalize(farPoint-start);
        float depth=texture2D(sceneDepth,vUv).x;
        float maxDistance=dot(worldAt(depth*2.0-1.0)-start,ray);
        vec3 center=coneOrigin+coneAxis*coneLength*.5;
        float radius=sqrt(coneLength*coneLength*.25+pow(coneLength*coneTangent,2.0));
        vec3 oc=start-center;float b=dot(oc,ray),discriminant=b*b-dot(oc,oc)+radius*radius;
        if(discriminant<=0.0)discard;
        float root=sqrt(discriminant),enter=max(0.0,-b-root),exit=min(maxDistance,-b+root);
        if(exit<=enter)discard;
        float stepSize=(exit-enter)/samples,opticalDepth=0.0;
        float jitter=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
        for(int i=0;i<32;i++){
          if(float(i)>=samples)break;
          vec3 point=start+ray*(enter+(float(i)+jitter)*stepSize),v=point-coneOrigin;
          float h=dot(v,coneAxis);
          if(h<=0.0||h>=coneLength)continue;
          float radial=length(v-coneAxis*h),r=h*coneTangent;
          if(radial>=r)continue;
          float density=(1.0-smoothstep(.45,1.0,radial/max(r,.001)))*smoothstep(0.0,.8,h)*(1.0-smoothstep(coneLength*.72,coneLength,h))/(1.0+.02*h*h);
          if(shadowReady>.5){
            vec4 projected=lightMatrix*vec4(point,1.0);vec3 uv=projected.xyz/projected.w;
            if(uv.x>0.0&&uv.x<1.0&&uv.y>0.0&&uv.y<1.0&&uv.z<1.0){
              float blocker=unpackRGBAToDepth(texture2D(lightShadow,uv.xy));
              if(uv.z-.002>blocker)density*=.08;
            }
          }
          opticalDepth+=density*stepSize;
        }
        float alpha=min(.12,1.0-exp(-opticalDepth*strength));
        if(alpha<.0005)discard;
        gl_FragColor=vec4(lightColor,alpha);
        #include <colorspace_fragment>
      }`
  });
  const overlay=new THREE.Scene(),overlayCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1),quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),material);
  quad.frustumCulled=false;overlay.add(quad);
  function resize(width,height,pixelRatio,mobile){target.setSize(Math.max(1,Math.ceil(width*pixelRatio*.6)),Math.max(1,Math.ceil(height*pixelRatio*.6)));uniforms.samples.value=mobile?24:32;uniforms.coneAxis.value.subVectors(light.target.position,light.position);uniforms.coneLength.value=uniforms.coneAxis.value.length();uniforms.coneAxis.value.normalize();uniforms.coneTangent.value=Math.tan(light.angle)}
  function render(){
    const oldMaterial=scene.overrideMaterial,oldShadowUpdate=renderer.shadowMap.autoUpdate,oldAutoClear=renderer.autoClear,hidden=[];
    scene.traverse(o=>{if((o.isSprite||o.isPoints)&&o.visible){hidden.push(o);o.visible=false}});
    try{renderer.shadowMap.autoUpdate=false;scene.overrideMaterial=depthMaterial;renderer.setRenderTarget(target);renderer.clear();renderer.render(scene,camera)}
    finally{scene.overrideMaterial=oldMaterial;renderer.shadowMap.autoUpdate=oldShadowUpdate;hidden.forEach(o=>o.visible=true);renderer.setRenderTarget(null)}
    renderer.autoClear=true;renderer.render(scene,camera);
    uniforms.lightShadow.value=light.shadow.map?.texture||null;uniforms.shadowReady.value=light.shadow.map?1:0;
    renderer.autoClear=false;renderer.render(overlay,overlayCamera);renderer.autoClear=oldAutoClear;
  }
  return{render,resize,uniforms,target};
}
