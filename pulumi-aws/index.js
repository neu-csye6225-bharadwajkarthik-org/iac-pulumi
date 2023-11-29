"use strict";
const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const gcp = require("@pulumi/gcp");
// const cloud = require("@pulumi/cloud");
const {CIDRBlockProvider} = require('./helpers');

const defaultNamespaceConfig = new pulumi.Config();
const awsNamespaceConfig = new pulumi.Config("aws");
const gcpNamespaceConfig = new pulumi.Config("gcp");

// Extract user input variables from config default namespace
const vpcCount = defaultNamespaceConfig.getNumber('vpcCount');
const vpcBaseAddress = defaultNamespaceConfig.require('vpcBaseAddress');
const vpcBitMaskLength = defaultNamespaceConfig.getNumber('vpcBitMaskLength');
const desiredTotalSubnetPairCount = defaultNamespaceConfig.getNumber('desiredTotalSubnetPairCount');



// extract inputs from variables in aws namespace
const region = awsNamespaceConfig.get('region');
const profile = awsNamespaceConfig.get('profile');

const queryAvailabilityZonesAndProvisionResources = async(provisionResources) => {
   try{
      const availabilityZonesObj = await aws.getAvailabilityZones({ state: "available" }, { provider: new aws.Provider("myprovider", { region, profile}) });
      console.log(`availabilityZonesObj = `, availabilityZonesObj);
      const availabilityZones = availabilityZonesObj.names;
      let totalSubnetCount = 0
      if(availabilityZones.length >= desiredTotalSubnetPairCount){
         console.log(`inside if statement : availabilityZones.length = ${availabilityZones.length} , desiredTotalSubnetPairCount = ${desiredTotalSubnetPairCount}`);
         totalSubnetCount = 2*desiredTotalSubnetPairCount;
      }else{
         console.log(`inside else statement : availabilityZones.length = ${availabilityZones.length} , desiredTotalSubnetPairCount = ${desiredTotalSubnetPairCount}`);
         totalSubnetCount = 2*availabilityZones.length;
      }
      provisionResources(availabilityZones, totalSubnetCount);
   }catch(e){
      console.log(`Error : ${e}`);
   }
}

const provisionResources = async(availabilityZones, totalSubnetCount) => {

   const totalSubnetBits = Math.ceil(Math.log2(totalSubnetCount));
   console.log(`Math.ceil(Math.log2(2*totalSubnetCount)) = ${Math.ceil(Math.log2(2*totalSubnetCount))}`)
   console.log(`totalSubnetBits = ${totalSubnetBits}`);
   
   for(let i = 0; i < vpcCount; i++){
      const vpc = new aws.ec2.Vpc(`vpc-${(i + 1)}`, {
         enableDnsSupport: true,      // Enable DNS resolution
         enableDnsHostnames: true,    // Enable DNS hostnames
         cidrBlock: CIDRBlockProvider.generateVpcCIDR(vpcBaseAddress, vpcBitMaskLength, i),
         tags: {
            Name: `vpc-${(i+1)}`,
        },
      });
   
      // Create an Internet Gateway for the vpc - '
      const internetGateway = new aws.ec2.InternetGateway(`InternetGateway-vpc-${(i+1)}`, {
         vpcId: vpc.id,
         tags: {
            Name: `InternetGateway-vpc-${(i+1)}`,
         },
      });
   
      // Create public route table in the vpc
      const publicRouteTable = new aws.ec2.RouteTable(`publicRouteTable-vpc-${(i+1)}`, {
         vpcId: vpc.id,
         tags: { Name: `publicRouteTable-vpc-${(i+1)}` },
      });
   
      // Define a public route in the public route table to the Internet Gateway
      const publicInternetGatewayRoute = new aws.ec2.Route(`publicInternetGatewayRoute-vpc-${(i+1)}`, {
         routeTableId: publicRouteTable.id,
         destinationCidrBlock: "0.0.0.0/0",
         gatewayId: internetGateway.id,
      });
   
      // Create private route table in the vpc
      const privateRouteTable = new aws.ec2.RouteTable(`privateRouteTable-vpc-${(i+1)}`, {
         vpcId: vpc.id,
         tags: { Name: `privateRouteTable-vpc-${(i+1)}` },
      });
   
      // create 'publicSubnetsCount' amount of public subnets
      // and attach them to the public route table
      const publicSubnets = [];
      for (let j = 0; j < totalSubnetCount/2; j++) {
         const subnet = new aws.ec2.Subnet(`publicSubnet-${(j+1)}-vpc-${(i+1)}`, {
             cidrBlock: CIDRBlockProvider.generateSubnetCIDR(vpcBaseAddress, vpcBitMaskLength, i, j, totalSubnetBits),
             availabilityZone: availabilityZones[j%availabilityZones.length], // Change the AZ as needed
             vpcId: vpc.id,
             mapPublicIpOnLaunch: true,  // Auto-assign public IP addresses
             tags: { Name: `publicSubnet-${(j+1)}-vpc-${(i+1)}` },
         });
         publicSubnets.push(subnet.id);
         // Associate public subnet with the public route table
         const publicSubnetRouteTableAssociation = new aws.ec2.RouteTableAssociation(`publicSubnetRouteTableAssociation-vpc-${(i + 1)}-subnet-${(j + 1)}`, {
            subnetId: subnet.id,
            routeTableId: publicRouteTable.id,
            tags: {
                Name: `publicSubnetRouteTableAssociation-vpc-${(i + 1)}-subnet-${(j + 1)}`,
            },
        });
      }
   
      // create 'privateSubnetsCount' amount of private subnets
      // and attach them to the private route table
      const privateSubnets = [];
      for (let j = totalSubnetCount/2; j < totalSubnetCount; j++) {
         const subnet = new aws.ec2.Subnet(`privateSubnet-${(j - totalSubnetCount/2 + 1)}-vpc-${(i+1)}`, {
             cidrBlock: CIDRBlockProvider.generateSubnetCIDR(vpcBaseAddress, vpcBitMaskLength, i, j, totalSubnetBits),  // Non-overlapping CIDR blocks for private subnets
             availabilityZone: availabilityZones[(j - totalSubnetCount/2)%availabilityZones.length], // same az as the corresponding public subnet number
             vpcId: vpc.id,
             tags: { Name: `privateSubnet-${(j - totalSubnetCount/2 + 1)}-vpc-${(i+1)}` },
         });
         privateSubnets.push(subnet.id);
         // Associate private subnets with the private route table
         const privateSubnetRouteTableAssociation = new aws.ec2.RouteTableAssociation(`PrivateSubnetRouteTableAssociation-vpc-${(i+1)}-subnet-${(j - totalSubnetCount/2 + 1)}`, {
            subnetId: subnet.id,
            routeTableId: privateRouteTable.id,
            tags: {
                Name: `PrivateSubnetRouteTableAssociation-vpc-${(i+1)}-subnet-${(j - totalSubnetCount/2 + 1)}`,
            },
        });
      }

      // ---------------------------------------LOAD BALANCER SECURITY GROUP ------------------------------------------------
      const loadbalancer_ingress_ports = defaultNamespaceConfig.require('LOADBALANCER_INGRESS_PORTS').split(',');
      const loadbalancer_ingress_protocol = defaultNamespaceConfig.require('LOADBALANCER_INGRESS_PROTOCOL');
      const loadbalancer_ingress_all_ipv4 = defaultNamespaceConfig.require('LOADBALANCER_INGRESS_ALL_IPV4');
      const loadbalancer_ingress_all_ipv6 = defaultNamespaceConfig.require('LOADBALANCER_INGRESS_ALL_IPV6');

      const loadbalancer_ingressRules = loadbalancer_ingress_ports.map(loadbalancer_ingress_port => ({
         fromPort: loadbalancer_ingress_port,
         toPort: loadbalancer_ingress_port,
         protocol: loadbalancer_ingress_protocol,
         cidrBlocks: [loadbalancer_ingress_all_ipv4],
         ipv6CidrBlocks: [loadbalancer_ingress_all_ipv6],
      }));

      const loadbalancer_egress_ports = defaultNamespaceConfig.require('LOADBALANCER_EGRESS_PORTS').split(',');
      const loadbalancer_egress_protocol = defaultNamespaceConfig.require('LOADBALANCER_EGRESS_PROTOCOL');
      const loadbalancer_egress_all_ipv4 = defaultNamespaceConfig.require('LOADBALANCER_EGRESS_ALL_IPV4');
      const loadbalancer_egress_all_ipv6 = defaultNamespaceConfig.require('LOADBALANCER_EGRESS_ALL_IPV6');

      const loadbalancer_egressRules = loadbalancer_egress_ports.map(loadbalancer_egress_port => ({
         fromPort: loadbalancer_egress_port,
         toPort: loadbalancer_egress_port,
         protocol: loadbalancer_egress_protocol,
         cidrBlocks: [loadbalancer_egress_all_ipv4],
         ipv6CidrBlocks: [loadbalancer_egress_all_ipv6],
      }));

      const loadbalancer_security_group_tag = defaultNamespaceConfig.require('LOADBALANCER_SECURITY_GROUP_TAG');

      const loadbalancerSecurityGroup = new aws.ec2.SecurityGroup(loadbalancer_security_group_tag, {
         description: "Load Balancer Security group to use as source for application security group",
         vpcId: vpc.id,
         ingress: loadbalancer_ingressRules,
         egress: loadbalancer_egressRules,
         tags: {
            Name: loadbalancer_security_group_tag,
         },
      });

      // -------------------------END OF LOAD BALANCER SECURITY GROUP ----------------------------------------

      // -------------------------APPLICATION SECURITY GROUP ----------------------------------------------------
      const application_ingress_ports = defaultNamespaceConfig.require('APPLICATION_INGRESS_PORTS').split(',');
      const application_ingress_protocol = defaultNamespaceConfig.require('APPLICATION_INGRESS_PROTOCOL');
      const application_ingress_all_ipv4 = defaultNamespaceConfig.require('APPLICATION_INGRESS_ALL_IPV4');
      const application_ingress_all_ipv6 = defaultNamespaceConfig.require('APPLICATION_INGRESS_ALL_IPV6');

      const application_ingressRules = application_ingress_ports.map(application_ingress_port => ({
         fromPort: application_ingress_port,
         toPort: application_ingress_port,
         protocol: application_ingress_protocol,
         // Conditionally include 'loadbalancerSecurityGroup' as source for all traffic into app except for ssh which can come from internet
         ...(Number(application_ingress_port) !== 22
            ? { securityGroups: [loadbalancerSecurityGroup.id] }
            : {
               cidrBlocks: [application_ingress_all_ipv4],
               ipv6CidrBlocks: [application_ingress_all_ipv6],
               }),
      }));

      const application_egress_ports = defaultNamespaceConfig.require('APPLICATION_EGRESS_PORTS').split(',');
      const application_egress_protocol = defaultNamespaceConfig.require('APPLICATION_EGRESS_PROTOCOL');
      const application_egress_all_ipv4 = defaultNamespaceConfig.require('APPLICATION_EGRESS_ALL_IPV4');
      const application_egress_all_ipv6 = defaultNamespaceConfig.require('APPLICATION_EGRESS_ALL_IPV6');

      const application_egressRules = application_egress_ports.map(application_egress_port => ({
         fromPort: application_egress_port,
         toPort: application_egress_port,
         protocol: application_egress_protocol,
         cidrBlocks: [application_egress_all_ipv4],
         ipv6CidrBlocks: [application_egress_all_ipv6],
      }));

      const application_security_group_tag = defaultNamespaceConfig.require('APPLICATION_SECURITY_GROUP_TAG');

      const applicationSecurityGroup = new aws.ec2.SecurityGroup(application_security_group_tag, {
         description: "EC2 Security group for the application server",
         vpcId: vpc.id,
         ingress: application_ingressRules,
         egress: application_egressRules,
         tags: {
            Name: application_security_group_tag,
         },
      });

      // --------------------------END OF APPLICATION SECURITY GROUP --------------------------------------------------

      // ------------------------- SNS TOPIC CREATION ----------------------------------------------------------
      const snsSubmissionTopic = new aws.sns.Topic("snsSubmissionTopic", {
          displayName: "snsSubmissionTopic",
          tags: {
            Name: "snsSubmissionTopic", 
        },
      });

      // ------------------------- END OF SNS TOPIC CREATION ---------------------------------------------------

      // ------------------------- INSTANCE PROFILE FOR CLOUDWATCH AND SNS ACCESS ---------------------------------
      // Create an IAM role with for EC2 to assume
      const cloudwatchAndSNSAccessRole = new aws.iam.Role('EC2CloudwatchAndSNSAccessRole', {
         name: 'EC2CloudwatchAndSNSAccessRole', // Specify a custom name for the IAM role
         assumeRolePolicy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
               {
                     Action: 'sts:AssumeRole',
                     Effect: 'Allow',
                     Principal: {
                        Service: 'ec2.amazonaws.com',
                     },
               },
            ],
         }),
         tags: {
            roleName: 'EC2CloudwatchAndSNSAccessRole'
         } 
      });

      // Attach - 'CloudWatchServerAgentPolicy'-  IAM policy to the custom - 'EC2CloudwatchAndSNSAccessRole' - IAM role created above
      const cloudwatchAgentPolicyAttachment = new aws.iam.PolicyAttachment('cloudwatch-agent-policy-attachment', {
         roles: [cloudwatchAndSNSAccessRole.name],
         policyArn: 'arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy',
      }); 

      // Create SNS publish policy
      const snsPublishPolicy = snsSubmissionTopic.arn.apply(publicPolicyArn => 
         new aws.iam.Policy("snsPublishPolicy", {
            policy: JSON.stringify({
               Version: "2012-10-17",
               Statement: [{
                     Effect: "Allow",
                     Action: "sns:Publish", 
                     Resource: publicPolicyArn, //"arn:aws:sns:*:*:*", 
               }],
            }),
         })
      );

      // Attach SNS-publish policy to the existing role
      const snsPublishPolicyAttachment = new aws.iam.PolicyAttachment('sns-server-policy-attachment', {
         roles: [cloudwatchAndSNSAccessRole.name],
         policyArn: snsPublishPolicy.arn,
         tags:{
            Name: 'AssignmentSubmissionTopic'
         }
      }); 

      // Create an instance profile for this role
      const cloudWatchAccessInstanceProfile = new aws.iam.InstanceProfile('EC2CloudwatchAndSNSAccessInstanceProfile', {
         name: 'EC2CloudwatchAndSNSAccessInstanceProfile', 
         role: cloudwatchAndSNSAccessRole.name, // Associate the IAM role with the instance profile
      });

      // ------------------------------ END OF INSTANCE PROFILE FOR CLOUDWATCH AND SNS ACCESS ----------------------------------------------

      // ------------------------------ START OF DYNAMODB -------------------------------------------------------

      // Create a DynamoDB Table
      const dynamoTable = new aws.dynamodb.Table("EmailsDeliveredTable", {
         // Define table attributes
         attributes: [
            { name: "id", type: "S" }, // String attribute (S)
         ],
         // Define primary key
         hashKey: "id",
         // Define provisioned throughput
         readCapacity: 5,
         writeCapacity: 5,
         tags: {
            Name: "EmailsDeliveredTable",
        },
      });
      dynamoTable.arn.apply((arn) => console.log(`dynamoTable.arn  = ` + arn +", name = ", arn.split('/').slice(-1)[0]));
      // const tableName = pulumi.interpolate`${dynamoTable.arn}`.apply(arn => arn.split('/').slice(-1)[0]);
      // console.log('tableName = ', tableName)
      // IAM role policy that allows 'PutItem' on the above DynamoDB table
      // Create PutItem Policy
      const dynamoDBPutItemPolicy = new aws.iam.Policy("dynamoDBPutItemPolicy", {
         policy: pulumi.output({
            Version: "2012-10-17",
            Statement: [{
               Action: "dynamodb:PutItem",
               Effect: "Allow",
               Resource: dynamoTable.arn
            }],
         }).apply(JSON.stringify),
      });
 
      // ------------------------------ END OF DYNAMODB ----------------------------------------------------------

      // ----------------------------- START OF GCS Bucket ------------------------------------------------------
      
      // Create a GCP service account
      const serviceAccount = new gcp.serviceaccount.Account("gcp-lambda", {
         accountId: "gcp-lambda",
         displayName: "GCP Lambda Service Account",
      });

      // Create access keys for the service account
      const serviceAccountKey = new gcp.serviceaccount.Key("gcp-lambda-key", {
         serviceAccountId: serviceAccount.accountId,
      });

      const projectId = gcpNamespaceConfig.require('project')
      // Create an IAM role giving ObjectCreator permission to the service account
      const serviceAccountObjectCreatorRoleBinding = new gcp.projects.IAMBinding("serviceAccountObjectCreatorRoleBinding", {
         role: "roles/storage.objectCreator",
         members: [serviceAccount.email.apply(email => "serviceAccount:" + email)],
         project: projectId
      });

      const serviceAccountListObjectRoleBinding = new gcp.projects.IAMBinding("serviceAccountListObjectRoleBinding", {
         role: "roles/storage.objectViewer", // The role you're applying (objectViewer grants list permissions)
         members: [serviceAccount.email.apply(email => "serviceAccount:" + email)], // Replace with the service account email
         project: projectId, // Replace with your GCP project ID
     });

      // Create a GCS bucket
      const bucket = new gcp.storage.Bucket("submissions-bucket", {
         location: "US",
         forceDestroy: true, // Allows Pulumi to delete the bucket (use carefully)
         publicAccessPrevention: "enforced" // deny public access to bucket with sensitive submission info
      });

      // ----------------------------- END OF GCS Bucket --------------------------------------------------------

      // ------------------------------ START OF LAMBDA FUNCTION ----------------------------------------------------

      // Create an IAM role for the Lambda function
      let lambdaRole = new aws.iam.Role('lambdaRole', {
         assumeRolePolicy: JSON.stringify({
            Version: '2012-10-17',
            Statement: [
               {
                     Action: 'sts:AssumeRole',
                     Effect: 'Allow',
                     Principal: {
                        Service: 'lambda.amazonaws.com'
                     }
               }
            ]
         })
      });

      // Attach the cloud watch logs policy to the Lambda role
      new aws.iam.PolicyAttachment("lambdaLogs", {
         roles: [lambdaRole.name],
         policyArn: aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole
      });

      // Define policy for read access from Secrets Manager
      let secretsReadPolicy = new aws.iam.Policy("secretsReadPolicy", {
         policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
               {
                     Effect: "Allow",
                     Action: "secretsmanager:GetSecretValue",
                     Resource: "*"
               }
            ]
         })
      });

      // Attach the Secrets Manager policy to the Lambda role
      new aws.iam.PolicyAttachment("lambdaSecrets", {
         roles: [lambdaRole.name],
         policyArn: secretsReadPolicy.arn
      });

      // Attach the DynamoDB PutItem policy to the Lambda role
      new aws.iam.PolicyAttachment("lambdaDynamoDBPut", {
         roles: [lambdaRole.name],
         policyArn: dynamoDBPutItemPolicy.arn
      });

      const DYNAMO_TABLE_NAME = pulumi.interpolate`${dynamoTable.arn}`.apply(arn => arn.split('/').slice(-1)[0]);

      // Create Lambda function using a local deployment file
      const DEPLOYMENT_ZIP_PATH = defaultNamespaceConfig.require('DEPLOYMENT_ZIP_PATH');
      // get email secret name 
      const EMAIL_SECRET_NAME = defaultNamespaceConfig.require('EMAIL_SECRET_NAME');
      const CC_EMAIL = defaultNamespaceConfig.require('CC_EMAIL')
      const lambdaFunction = new aws.lambda.Function("handleSubmissionAndSendEmail", {
         code: new pulumi.asset.AssetArchive({
            ".": new pulumi.asset.FileArchive(DEPLOYMENT_ZIP_PATH),
         }),
         role: lambdaRole.arn,
         handler: "index.handler", // the handler function inside index.js 
         runtime: aws.lambda.Runtime.NodeJS18dX, 
         tags: {
            Name: "handleSubmissionAndSendEmail",
        },
         environment: {
            variables: {
               DYNAMO_TABLE_NAME: DYNAMO_TABLE_NAME,
               GCS_BUCKET_NAME: bucket.name,
               GCP_SERVICE_ACCOUNT_KEY: serviceAccountKey.privateKey,
               REGION_AWS: region,
               EMAIL_SECRET_NAME: EMAIL_SECRET_NAME,
               CC_EMAIL: CC_EMAIL
            },
         },
         timeout: 60,
      });

      const lambdaTriggerFromSnsPermission = new aws.lambda.Permission("lambdaTriggerFromSnsPermission", {
         action: "lambda:InvokeFunction",
         function: lambdaFunction.name,
         principal: "sns.amazonaws.com",
         sourceArn: snsSubmissionTopic.arn, 
     });
     
     const snsSubmissionTopicSubscription = new aws.sns.TopicSubscription("snsSubmissionTopicSubscription", {
         endpoint: lambdaFunction.arn,
         protocol: "lambda",
         topic: snsSubmissionTopic.arn, 
     });

      // ------------------------------ END OF LAMBDA FUNCTION ----------------------------------------------------


      const database_security_group_tag = defaultNamespaceConfig.require('DATABASE_SECURITY_GROUP_TAG');
      const database_ingress_protocol = defaultNamespaceConfig.require('DATABASE_INGRESS_PROTOCOL');
      const database_ingress_port = defaultNamespaceConfig.getNumber('DATABASE_INGRESS_PORT');

      applicationSecurityGroup.id.apply((id) => console.log(`applicationSecurityGroup.id for use in databaseSecurityGroup = ` + id));

      const databaseSecurityGroup = new aws.ec2.SecurityGroup(database_security_group_tag, {
         description: "EC2 Security group for the database server",
         vpcId: vpc.id,
         ingress: [{
             description: "Ingress rules for TCP Traffic inbound on database server",
             fromPort: database_ingress_port,
             toPort: database_ingress_port,
             protocol: database_ingress_protocol,
             securityGroups : [applicationSecurityGroup.id]
         }],
         tags: {
             Name: database_security_group_tag,
         },
      },{ dependsOn: [applicationSecurityGroup] });

      const database_family = defaultNamespaceConfig.require('DATABASE_FAMILY');
      const rds_parameter_group_tag = defaultNamespaceConfig.require('RDS_PARAMETER_GROUP_TAG');

      const rds_parameter_group = new aws.rds.ParameterGroup(rds_parameter_group_tag, {
         family: database_family,
         tags: {
            Name: rds_parameter_group_tag,
         },
      });

      const rds_subnet_group_tag = defaultNamespaceConfig.require('RDS_SUBNET_GROUP_TAG');
      const rds_subnet_group = new aws.rds.SubnetGroup(rds_subnet_group_tag, {
         subnetIds: [
             privateSubnets[0], 
             privateSubnets[1]
         ],
         tags: {
             Name: rds_subnet_group_tag,
         },
     });

      const rds_instance_tag = defaultNamespaceConfig.require('RDS_INSTANCE_TAG');
      const db_engine = defaultNamespaceConfig.require('DATABASE_ENGINE');
      const db_engine_version = defaultNamespaceConfig.require('DATABASE_ENGINE_VERSION');
      const db_instance_class = defaultNamespaceConfig.require('DATABASE_INSTANCE_CLASS');
      const database_instance_identifier = defaultNamespaceConfig.require('DATABASE_INSTANCE_IDENTIFIER');
      const database_allocated_storage = defaultNamespaceConfig.getNumber('DATABASE_ALLOCATED_STORAGE');
      const db_username = defaultNamespaceConfig.require('DATABASE_USERNAME');
      const db_password = defaultNamespaceConfig.require('DATABASE_PASSWORD');
      const db_name = defaultNamespaceConfig.require('DATABASE_NAME');

      databaseSecurityGroup.id.apply((id) => console.log(`databaseSecurityGroup.id for use in rds_instance = ` + id));
      rds_parameter_group.name.apply((name) => console.log(`rds_parameter_group.name for use in rds_instance = ` + name));
      rds_subnet_group.name.apply((name) => console.log(`rds_subnet_group.name for use in rds_instance = ` + name));
      
      const rds_instance = new aws.rds.Instance(rds_instance_tag, {
         allocatedStorage: database_allocated_storage,
         dbName: db_name,
         engine: db_engine,
         engineVersion: db_engine_version,
         instanceClass: db_instance_class,
         parameterGroupName: rds_parameter_group.name,
         username:db_username,
         password: db_password,
         dbSubnetGroupName: rds_subnet_group.name,
         multiAz: false,
         identifier: database_instance_identifier,
         publiclyAccessible: false, // need to make false
         skipFinalSnapshot: true,
         vpcSecurityGroupIds: [databaseSecurityGroup.id],
         tags: {
            Name: rds_instance_tag,
         },
      }, { dependsOn: [rds_subnet_group,databaseSecurityGroup,rds_parameter_group] });

      rds_instance.address.apply((address) => console.log(`rds_instance address = ` + address));
      rds_instance.endpoint.apply((endpoint) => console.log(`rds_instance endpoint = ` + endpoint));
   
      const WEBAPP_PATH = defaultNamespaceConfig.require('WEBAPP_PATH');

      

      // --------------------------- START OF LAUNCH TEMPLATE ---------------------------------------

      const WEBAPP_LAUNCH_TEMPLATE_TAG = defaultNamespaceConfig.require('WEBAPP_LAUNCH_TEMPLATE_TAG');   
      const AMI_ID = defaultNamespaceConfig.require('AMI_ID');
      const ec2_key_pair = defaultNamespaceConfig.require('EC2_KEY_PAIR');
      const disableApiTermination = defaultNamespaceConfig.require('DISABLE_API_TERMINATION');
      const deleteOnTermination = defaultNamespaceConfig.require('DELETE_ON_TERMINATION');
      const rootVolumeSize = defaultNamespaceConfig.getNumber('ROOT_VOLUME_SIZE');
      const rootVolumeType = defaultNamespaceConfig.require('ROOT_VOLUME_TYPE');
      const instanceType = defaultNamespaceConfig.require('INSTANCE_TYPE');

      console.log('disableApiTermination = ', disableApiTermination);
      console.log('deleteOnTermination = ', deleteOnTermination);
      console.log('rootVolumeSize = ', rootVolumeSize);
      console.log('rootVolumeType = ', rootVolumeType);
      console.log('instanceType = ', instanceType);

      const userDataScript = pulumi.interpolate`#!/bin/bash
      # Update the .env file with rds host value, user, pass, and db name
      sed -i 's/HOST=.*/HOST=${rds_instance.address}/' ${WEBAPP_PATH}/.env
      # Update the .env file with rds db name value
      sed -i 's/DB=.*/DB=${db_name}/' ${WEBAPP_PATH}/.env
      # Update the .env file with rds username value
      sed -i 's/DB_USERNAME=.*/DB_USERNAME=${db_username}/' ${WEBAPP_PATH}/.env
      # Update the .env file with rds password value
      sed -i 's/DB_PASSWORD=.*/DB_PASSWORD=${db_password}/' ${WEBAPP_PATH}/.env
      # Update the .env file with SNS TOPIC ARN
      sed -i 's/SNS_TOPIC_ARN=.*/SNS_TOPIC_ARN=${snsSubmissionTopic.arn}/' ${WEBAPP_PATH}/.env
      # Update the .env file with AWS REGION
      sed -i 's/AWS_REGION=.*/AWS_REGION=${region}/' ${WEBAPP_PATH}/.env

      # Change the ownership of the .env file to a specific user and group
      sudo chown csye6225:csye6225 ${WEBAPP_PATH}/.env
      # Change the permissions of the .env file
      sudo chmod 755 ${WEBAPP_PATH}/.env

      # Execute cloudwatch agent with config file provisioned in known location through AMI
      sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
         -a fetch-config \
         -m ec2 \
         -c file:/opt/csye6225/webapp/cloudwatch-config.json \
         -s

      `;

      const launch_template = new aws.ec2.LaunchTemplate(WEBAPP_LAUNCH_TEMPLATE_TAG, {
         blockDeviceMappings: [{
             deviceName: "/dev/xvda",
             ebs: {
               volumeSize: rootVolumeSize,
               volumeType: rootVolumeType,
               deleteOnTermination: deleteOnTermination,
             },
         }],
         disableApiTermination: disableApiTermination,
         iamInstanceProfile: {
             name: cloudWatchAccessInstanceProfile.name,
         },
         imageId: AMI_ID,
         instanceType: instanceType,
         keyName: ec2_key_pair,
         monitoring: {
             enabled: true,
         },
         networkInterfaces: [{
             associatePublicIpAddress: "true",
             securityGroups: [applicationSecurityGroup.id]
         }],
         userData: pulumi.output(userDataScript).apply(script => {
            const encoded = Buffer.from(script).toString('base64');
            console.log(`Encoded UserData: ${encoded}`);
            const decoded = Buffer.from(encoded, 'base64').toString();
            console.log('Decoded : ', decoded)
            return encoded;
        }),
         tags: {
            Name: WEBAPP_LAUNCH_TEMPLATE_TAG
         },
     });
      // --------------------------- END OF LAUNCH TEMPLATE -----------------------------------------------------------

      // --------------------------- START OF LOAD BALANCER -----------------------------------------------------------
      
      // Load balancer conf vars
      const LOAD_BALANCER_TYPE = defaultNamespaceConfig.require('LOAD_BALANCER_TYPE');
      const LOAD_BALANCER_IS_INTERNAL = defaultNamespaceConfig.require('LOAD_BALANCER_IS_INTERNAL')
      const LOAD_BALANCER_IS_DELETE_PROTECTION_ENABLED = defaultNamespaceConfig.require('LOAD_BALANCER_IS_DELETE_PROTECTION_ENABLED');

      const application_load_balancer = new aws.lb.LoadBalancer("app-load-balancer", {
         internal: LOAD_BALANCER_IS_INTERNAL,
         loadBalancerType: LOAD_BALANCER_TYPE,
         securityGroups: [loadbalancerSecurityGroup.id],
         subnets: publicSubnets,
         enableDeletionProtection: LOAD_BALANCER_IS_DELETE_PROTECTION_ENABLED,
         tags: {
             Name: "app-load-balancer",
         },
     });

     // Target group conf vars
      const APP_PORT = defaultNamespaceConfig.getNumber('APP_PORT');
      const TARGET_GROUP_PROTOCOL = defaultNamespaceConfig.require('TARGET_GROUP_PROTOCOL');
      const TARGET_GROUP_TYPE = defaultNamespaceConfig.require('TARGET_GROUP_TYPE');
      const TARGET_GROUP_IP_ADDRESS_TYPE = defaultNamespaceConfig.require('TARGET_GROUP_IP_ADDRESS_TYPE');
      const TARGET_GROUP_PROTOCOL_VERSION = defaultNamespaceConfig.require('TARGET_GROUP_PROTOCOL_VERSION');
      const HEALTH_CHECK_SUCCESS_CODE = defaultNamespaceConfig.require('HEALTH_CHECK_SUCCESS_CODE');
      const HEALTH_CHECK_HEALTHY_THRESHOLD = defaultNamespaceConfig.getNumber('HEALTH_CHECK_HEALTHY_THRESHOLD')
      const HEALTH_CHECK_UNHEALTHY_THRESHOLD = defaultNamespaceConfig.getNumber('HEALTH_CHECK_UNHEALTHY_THRESHOLD')
      const HEALTH_CHECK_INTERVAL = defaultNamespaceConfig.getNumber('HEALTH_CHECK_INTERVAL')
      const HEALTH_CHECK_TIMEOUT = defaultNamespaceConfig.getNumber('HEALTH_CHECK_TIMEOUT')
      const HEALTH_CHECK_PATH = defaultNamespaceConfig.require('HEALTH_CHECK_PATH');
      const HEALTH_CHECK_PORT = defaultNamespaceConfig.require('HEALTH_CHECK_PORT');
      const HEALTH_CHECK_PROTOCOL = defaultNamespaceConfig.require('HEALTH_CHECK_PROTOCOL')

      // Target Group
      const targetGroup = new aws.lb.TargetGroup("lb-target-group", {
         port: APP_PORT, // Specify the port for the target group
         protocol: TARGET_GROUP_PROTOCOL, // Specify the protocol (e.g., "HTTP", "HTTPS")
         targetType: TARGET_GROUP_TYPE, 
         ipAddressType: TARGET_GROUP_IP_ADDRESS_TYPE,
         vpcId: vpc.id,
         protocolVersion: TARGET_GROUP_PROTOCOL_VERSION,
         healthCheck: {
             path: HEALTH_CHECK_PATH, // Specify the health check path
             port: HEALTH_CHECK_PORT, // Use "traffic-port" to match the target group port which is also app port in my case
             protocol: HEALTH_CHECK_PROTOCOL, // Specify the health check protocol
             healthyThreshold: HEALTH_CHECK_HEALTHY_THRESHOLD,
             unhealthyThreshold: HEALTH_CHECK_UNHEALTHY_THRESHOLD,
     
             matcher: HEALTH_CHECK_SUCCESS_CODE,
             interval: HEALTH_CHECK_INTERVAL,
             timeout: HEALTH_CHECK_TIMEOUT,
         },
         tags: {
            Name: "lb-target-group",
        }
      })

      //lb listener conf vars:
      const LB_LISTENER_PORT = defaultNamespaceConfig.getNumber('LB_LISTENER_PORT');
      const LB_LISTENER_PROTOCOL = defaultNamespaceConfig.require('LB_LISTENER_PROTOCOL');
      const LB_LISTENER_ACTION_TYPE = defaultNamespaceConfig.require('LB_LISTENER_ACTION_TYPE');

      // lb listener
      const application_loadbalancer_listener = new aws.lb.Listener("app-lb-listener", {
         loadBalancerArn: application_load_balancer.arn,
         port: LB_LISTENER_PORT,
         protocol: LB_LISTENER_PROTOCOL,
       
         
         defaultActions: [{
             type: LB_LISTENER_ACTION_TYPE,
             targetGroupArn: targetGroup.arn,
         }],
     });

      // --------------------------- END OF LOAD BALANCER -----------------------------------------------------------


      // ----------------------------AUTOSCALER -----------------------------------------------------------
      /*
      DESIRED_CAPACITY: 1
  MIN_SIZE: 1
  MAX_SIZE: 3
  COOLDOWN: 60
  HEALTH_CHECK_GRACE_PERIOD: 100
   */
      const DESIRED_CAPACITY = defaultNamespaceConfig.getNumber('DESIRED_CAPACITY')
      const MIN_SIZE = defaultNamespaceConfig.getNumber('MIN_SIZE');
      const MAX_SIZE = defaultNamespaceConfig.getNumber('MAX_SIZE')
      const COOLDOWN = defaultNamespaceConfig.getNumber('COOLDOWN')
      const HEALTH_CHECK_GRACE_PERIOD = defaultNamespaceConfig.getNumber('HEALTH_CHECK_GRACE_PERIOD')

      const autoscalingGroup = new aws.autoscaling.Group("autoscaling-group", {
         vpcZoneIdentifiers: publicSubnets,
         targetGroupArns: [targetGroup.arn],
         desiredCapacity: DESIRED_CAPACITY,
         maxSize: MAX_SIZE,
         minSize: MIN_SIZE,
         defaultCooldown: COOLDOWN,
         healthCheckGracePeriod: HEALTH_CHECK_GRACE_PERIOD, 
         healthCheckType: "ELB",
         mixedInstancesPolicy: {
             launchTemplate: {
                 launchTemplateSpecification: {
                     launchTemplateId: launch_template.id,
                 },
             },
         },
         tags: [{
            key: "Name",
            value: "autoscaling-group-instance",
            propagateAtLaunch: true,
        }],
      });

      const scaleUpPolicy = new aws.autoscaling.Policy('scaleUpPolicy', {
         adjustmentType: 'ChangeInCapacity',
         policyType: 'StepScaling',
         // Increment by 1
         stepAdjustments: [{scalingAdjustment: 1,
            metricIntervalLowerBound: "0",
            }],
         autoscalingGroupName: autoscalingGroup.name,
     });
     
     const scaleDownPolicy = new aws.autoscaling.Policy('scaleDownPolicy', {
         adjustmentType: 'ChangeInCapacity',
         policyType: 'StepScaling',
         // Decrement by 1
         stepAdjustments: [{scalingAdjustment: -1,
      
         metricIntervalUpperBound: "0"}],
         autoscalingGroupName: autoscalingGroup.name,
     });
     
     // Create CloudWatch metric alarms
     // Scale up when CPU usage is above 5%

     /*CPU_HIGH_ALARM_STATISTIC: 'Average'
  CPU_HIGH_ALARM_PERIOD: '60'
  CPU_HIGH_ALARM_THRESHOLD: '5'
  CPU_HIGH_ALARM_EVALUATION_PERIOD: '1'
  CPU_HIGH_ALARM_COMPARISON_OPERATOR: 'GreaterThanThreshold' */

     const CPU_HIGH_ALARM_STATISTIC = defaultNamespaceConfig.require('CPU_HIGH_ALARM_STATISTIC')
     const CPU_HIGH_ALARM_PERIOD = defaultNamespaceConfig.require('CPU_HIGH_ALARM_PERIOD')
     const CPU_HIGH_ALARM_THRESHOLD = defaultNamespaceConfig.require('CPU_HIGH_ALARM_THRESHOLD')
     const CPU_HIGH_ALARM_EVALUATION_PERIOD = defaultNamespaceConfig.require('CPU_HIGH_ALARM_EVALUATION_PERIOD')
     const CPU_HIGH_ALARM_COMPARISON_OPERATOR = defaultNamespaceConfig.require('CPU_HIGH_ALARM_COMPARISON_OPERATOR')

     const cpuHighAlarm = new aws.cloudwatch.MetricAlarm('cpuHighAlarm', {
         alarmActions: [scaleUpPolicy.arn],
         metricName: 'CPUUtilization',
         namespace: 'AWS/EC2',
         statistic: CPU_HIGH_ALARM_STATISTIC,
         period: CPU_HIGH_ALARM_PERIOD,
         evaluationPeriods: CPU_HIGH_ALARM_EVALUATION_PERIOD,
         comparisonOperator: CPU_HIGH_ALARM_COMPARISON_OPERATOR,
         threshold: CPU_HIGH_ALARM_THRESHOLD,
         dimensions: {
             AutoScalingGroupName: autoscalingGroup.name,
         },
     });
     
     const CPU_LOW_ALARM_STATISTIC = defaultNamespaceConfig.require('CPU_LOW_ALARM_STATISTIC')
     const CPU_LOW_ALARM_PERIOD = defaultNamespaceConfig.require('CPU_LOW_ALARM_PERIOD')
     const CPU_LOW_ALARM_THRESHOLD = defaultNamespaceConfig.require('CPU_LOW_ALARM_THRESHOLD')
     const CPU_LOW_ALARM_EVALUATION_PERIOD = defaultNamespaceConfig.require('CPU_LOW_ALARM_EVALUATION_PERIOD')
     const CPU_LOW_ALARM_COMPARISON_OPERATOR = defaultNamespaceConfig.require('CPU_LOW_ALARM_COMPARISON_OPERATOR')

     // Scale down when CPU usage is below 3%
     const cpuLowAlarm = new aws.cloudwatch.MetricAlarm('cpuLowAlarm', {
         alarmActions: [scaleDownPolicy.arn],
         metricName: 'CPUUtilization',
         namespace: 'AWS/EC2',
         statistic: CPU_LOW_ALARM_STATISTIC,
         period: CPU_LOW_ALARM_PERIOD,
         evaluationPeriods: CPU_LOW_ALARM_EVALUATION_PERIOD,
         comparisonOperator: CPU_LOW_ALARM_COMPARISON_OPERATOR,
         threshold: CPU_LOW_ALARM_THRESHOLD,
         dimensions: {
             AutoScalingGroupName: autoscalingGroup.name,
         },
     });
  
      // ----------------------------END OF AUTOSCALER----------------------------------------------------------------

      // --------------------------- ROUTE 53 -----------------------------------------------------

      const SUBDOMAIN_HOSTED_ZONE_ID = defaultNamespaceConfig.require('SUBDOMAIN_HOSTED_ZONE_ID'); // Replace with your hosted zone ID
      const SUBDOMAIN_NAME = defaultNamespaceConfig.require('SUBDOMAIN_NAME'); // Replace with the subdomain you want to update
      const RECORD_NAME = defaultNamespaceConfig.require('RECORD_TAG');
      const RECORD_TTL = defaultNamespaceConfig.getNumber('RECORD_TTL')
      
      // console.log(hostedZoneId)
      // Create an CNAME record for the subdomain
      const aRecord = new aws.route53.Record(RECORD_NAME, {
         name: SUBDOMAIN_NAME,
         type: "A",
         zoneId: SUBDOMAIN_HOSTED_ZONE_ID,
         // ttl: RECORD_TTL, 
         aliases: [
            {
                name: application_load_balancer.dnsName,
                zoneId: application_load_balancer.zoneId,   // This is the hosted zone ID of the ELB, available in AWS console
                evaluateTargetHealth: true,
            },
        ],
      });

      // --------------------------------- END OF ROUTE 53 -----------------------------------------
      
   }

}


queryAvailabilityZonesAndProvisionResources(provisionResources);
