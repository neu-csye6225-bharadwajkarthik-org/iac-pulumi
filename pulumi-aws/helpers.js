const CIDRBlockProvider = {
    generateSubnetCIDR : (vpcBaseAddress, vpcBitMaskLength, currentVpcCount, currentSubnetCount, totalSubnetBits) => {
      const subnetBitMaskLength = (vpcBitMaskLength + totalSubnetBits);
      
      const vpcBaseAddressParts = vpcBaseAddress.split('.').map((part) => parseInt(part, 10));;
      const totalIpsVpcBase = vpcBaseAddressParts[0]*(256*256*256) + vpcBaseAddressParts[1]*(256*256) + vpcBaseAddressParts[2]*256 + vpcBaseAddressParts[3];

      const ipsPerVpc = 2 ** (32 - vpcBitMaskLength);
      const totalIpsCurrentVpcBase = currentVpcCount*ipsPerVpc + totalIpsVpcBase;

      const ipsPerSubnet = 2 ** (32 - subnetBitMaskLength);
      const totalIpsCurrentSubnetBase = totalIpsCurrentVpcBase + (ipsPerSubnet*currentSubnetCount) 
      // totalIpsCurrentSubnetBase = 256^3(firstOctet) + 256^2(secondOctet) + 256^1(thirdOctet) + 256^0(fourthOctet)

      const firstOctet = Math.floor(totalIpsCurrentSubnetBase/(256*256*256));
      const secondOctet = Math.floor(totalIpsCurrentSubnetBase/(256*256))%256; 
      const thirdOctet = Math.floor(totalIpsCurrentSubnetBase/256)%256;
      const fourthOctet = totalIpsCurrentSubnetBase%256;
      return `${firstOctet}.${secondOctet}.${thirdOctet}.${fourthOctet}/${subnetBitMaskLength}`;
   },

   generateVpcCIDR: (vpcBaseAddress, vpcBitMaskLength, currentVpcCount) => {
      const ipsPerVpc = 2 ** (32 - vpcBitMaskLength);
      
      const vpcBaseAddressParts = vpcBaseAddress.split('.').map((part) => parseInt(part, 10));;
      const totalIpsVpcBase = vpcBaseAddressParts[0]*(256*256*256) + vpcBaseAddressParts[1]*(256*256) + vpcBaseAddressParts[2]*256 + vpcBaseAddressParts[3];
      const totalIpsCurrentVpcBase = currentVpcCount*ipsPerVpc + totalIpsVpcBase;

       // totalIpsCurrentVpcBase = 256^3(firstOctet) + 256^2(secondOctet) + 256^1(thirdOctet) + 256^0(fourthOctet)
      const firstOctet = Math.floor(totalIpsCurrentVpcBase/(256*256*256)); 
      const secondOctet = Math.floor(totalIpsCurrentVpcBase/(256*256))%256; 
      const thirdOctet = Math.floor(totalIpsCurrentVpcBase/256)%256;
      const fourthOctet = totalIpsCurrentVpcBase%256; 

      return `${firstOctet}.${secondOctet}.${thirdOctet}.${fourthOctet}/${vpcBitMaskLength}`;
   }
}


module.exports = {
   CIDRBlockProvider
}